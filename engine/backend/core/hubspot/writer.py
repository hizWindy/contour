"""Writing to HubSpot (PLAN-V5 B5): the one way any project changes Contour's HubSpot.

A project describes the change (`WriteRequest`): which company, the fields to fill, a note, and a
list. The core then:
1. **Previews** it (`preview_write`): it finds the company in HubSpot (by id, else by domain, else
   by exact name), reads it, and works out what would be written. A field that already has a
   value is kept (rule 3: what a person typed stays). A field HubSpot doesn't have yet, or a
   pick-list value HubSpot doesn't offer, goes into the note instead. The plan is saved in
   `core.hubspot_writes` as "previewed". Nothing is written. This works while writing is off.
2. **Writes** it after a person confirms (`apply_write`), step by step: the company (made, or its
   empty fields filled), the note, the list. Right before writing, the company is read again and
   any field that has a value now is dropped. Each step's result is saved as it lands.
3. **Once only** (rule 4): the write's id is its key. Applying a finished write again returns its
   result. A project gets one open write per subject (like one lead): a second preview of a lead
   that was sent returns the first write. A write that timed out is never sent again blind: a
   company is looked for by domain or name first, and a note that may have landed is not sent
   again (the log says to check HubSpot).
4. Our copy of the company is updated at once after it is written, so pages show it.

It is off unless `HUBSPOT_WRITE_ENABLED=true` (`HubSpotWritesOff`, "Waiting for write access").
"""

import html
import logging
import re
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.hubspot.client import (
    Filter,
    HubSpot,
    HubSpotError,
    HubSpotNotFound,
    HubSpotObject,
    HubSpotWritesOff,
    HubSpotWriteUncertain,
    PropertyInfo,
)
from core.hubspot.importer import normalize_domain
from core.hubspot.mapping import Converter, Lookups, Problems, company_rows, load_field_map
from core.hubspot.models import HubSpotOwner, HubSpotWrite
from core.hubspot.service import replace_offices, upsert_companies
from core.logs import scrub

log = logging.getLogger(__name__)

StepName = Literal["company", "note", "list"]
StepStatus = Literal["done", "failed", "uncertain", "skipped"]
WriteStatus = Literal["previewed", "writing", "done", "partial", "failed", "uncertain"]
OPEN = ("previewed", "failed")  # a new preview may plan these again
CONTINUE = ("partial", "uncertain")  # applying again finishes these
NOTE_MAX_CHARS = 60_000  # HubSpot's note body limit is 65,536
WRITE_OFF = "Waiting for write access"

OnWritten = Callable[[AsyncSession, "WriteOut"], Awaitable[None]]


class WriteInProgress(Exception):
    """Another write for the same subject is being written right now."""


class WriteNotFound(Exception):
    """No write with this id."""


# --- What a project asks for -----------------------------------------------------------------


class CompanyTarget(BaseModel):
    model_config = ConfigDict(frozen=True)

    hubspot_id: str | None = Field(None, description="The company in HubSpot, when it is known")
    name: str = Field(min_length=1, max_length=300)
    domain: str | None = Field(None, description="A plain domain, like acme.com.au")


class WriteRequest(BaseModel):
    """A change one project asks for. `fields` are HubSpot property names with our values; a
    pick-list value may be its label or HubSpot's code. `labels` name the fields for people."""

    model_config = ConfigDict(frozen=True)

    app: str = Field(min_length=1, max_length=64)
    subject: str = Field(min_length=1, max_length=120)
    company: CompanyTarget
    fields: dict[str, str] = Field(default_factory=dict)
    labels: dict[str, str] = Field(default_factory=dict)
    note: str | None = None
    list_name: str | None = None
    warnings: list[str] = Field(
        default_factory=list, description="What a person should know before confirming"
    )


# --- What the preview and the log show -------------------------------------------------------


class FieldChange(BaseModel):
    property: str
    label: str
    value: str = Field(description="What would be written, in HubSpot's own form")
    current: str | None = Field(None, description="What HubSpot has now")
    write: bool = Field(description="False when it is kept as it is, or goes in the note")
    reason: str | None = Field(None, description="Why it is not written, in plain words")


class WritePlan(BaseModel):
    action: Literal["create", "update"]
    company_id: str | None
    company_name: str
    company_url: str | None
    domain: str | None
    fields: list[FieldChange]
    note: str | None = Field(None, description="The note's text, as it would be added")
    list_name: str | None
    list_id: str | None
    warnings: list[str] = Field(default_factory=list)


class StepResult(BaseModel):
    step: StepName
    status: StepStatus
    detail: str | None = None
    hubspot_id: str | None = None


class WriteOut(BaseModel):
    id: uuid.UUID
    app: str
    subject: str
    status: WriteStatus
    plan: WritePlan
    steps: list[StepResult]
    hubspot_company_id: str | None
    hubspot_url: str | None
    error: str | None
    created_at: datetime
    applied_at: datetime | None
    finished_at: datetime | None
    can_write: bool = Field(description="Whether writing is switched on (HUBSPOT_WRITE_ENABLED)")
    waiting_for: str | None = Field(None, description="Why writing can't happen yet, if it can't")


def write_out(row: HubSpotWrite) -> WriteOut:
    settings = get_settings()
    steps = [StepResult.model_validate(step) for step in (row.result or {}).get("steps", [])]
    return WriteOut(
        id=row.id,
        app=row.app,
        subject=row.subject,
        status=row.status,
        plan=WritePlan.model_validate(row.plan),
        steps=steps,
        hubspot_company_id=row.hubspot_company_id,
        hubspot_url=row.hubspot_url,
        error=row.error,
        created_at=row.created_at,
        applied_at=row.applied_at,
        finished_at=row.finished_at,
        can_write=settings.hubspot_write_enabled,
        waiting_for=None if settings.hubspot_write_enabled else WRITE_OFF,
    )


# --- Finding the company ---------------------------------------------------------------------


async def find_company(
    hubspot: HubSpot, target: CompanyTarget, properties: Sequence[str]
) -> tuple[HubSpotObject | None, list[str]]:
    """The company in HubSpot: by id, else by domain, else by exact name. With the warnings a
    person should see (like two companies with the same domain)."""
    warnings: list[str] = []
    if target.hubspot_id:
        found = await hubspot.get_object("companies", target.hubspot_id, properties=properties)
        if found is not None:
            return found, warnings
        warnings.append("The company this lead was matched to is no longer in HubSpot.")
    domain = normalize_domain(target.domain)
    searches = [Filter("domain", "EQ", domain)] if domain else []
    searches.append(Filter("name", "EQ", target.name.strip()))
    for search in searches:
        page = await hubspot.search_objects(
            "companies", filters=[search], properties=properties, limit=10
        )
        if page.results:
            if len(page.results) > 1:
                warnings.append(
                    f"HubSpot has {len(page.results)} companies with this "
                    f"{'domain' if search.property == 'domain' else 'name'}. The oldest record "
                    "is used."
                )
            return min(page.results, key=lambda record: int(record.id)), warnings
    return None, warnings


# --- Preview ---------------------------------------------------------------------------------


def _choice_code(info: PropertyInfo, value: str) -> str | None:
    """The stored code for a pick-list value given as its label or as the code itself."""
    wanted = value.strip().casefold()
    for choice in info.choices:
        if wanted in (choice.value.casefold(), choice.label.strip().casefold()):
            return choice.value
    return None


async def plan_write(hubspot: HubSpot, request: WriteRequest) -> WritePlan:
    """Works out what a write would do, from HubSpot as it is now. Writes nothing."""
    definitions = {item.name: item for item in await hubspot.properties("companies")}
    asked = list(dict.fromkeys(["name", "domain", *request.fields]))
    found, found_warnings = await find_company(
        hubspot, request.company, [name for name in asked if name in definitions]
    )
    warnings = [*request.warnings, *found_warnings]
    changes: list[FieldChange] = []
    for name, raw_value in request.fields.items():
        label = request.labels.get(name, name)
        value = raw_value.strip()
        if not value:
            continue
        info = definitions.get(name)
        if info is None:
            changes.append(
                FieldChange(
                    property=name,
                    label=label,
                    value=value,
                    write=False,
                    reason="HubSpot has no such field yet, so it goes in the note.",
                )
            )
            continue
        if info.choices:
            code = _choice_code(info, value)
            if code is None:
                changes.append(
                    FieldChange(
                        property=name,
                        label=label,
                        value=value,
                        write=False,
                        reason="Not one of HubSpot's choices here, so it goes in the note.",
                    )
                )
                continue
            value = code
        current = found.text(name) if found is not None else None
        changes.append(
            FieldChange(
                property=name,
                label=label,
                value=value,
                current=current,
                write=current is None,
                reason=None if current is None else "HubSpot already has a value. It is kept.",
            )
        )

    list_id: str | None = None
    if request.list_name:
        lists = [
            item
            for item in await hubspot.find_lists(request.list_name)
            if item.name.strip().casefold() == request.list_name.strip().casefold()
        ]
        manual = [item for item in lists if item.processing_type.upper() in ("MANUAL", "SNAPSHOT")]
        if manual:
            list_id = manual[0].id
        elif lists:
            warnings.append(
                f"The list '{request.list_name}' fills itself (a dynamic list), so a company "
                "can't be added to it by hand."
            )
        else:
            warnings.append(f"HubSpot has no list named '{request.list_name}' yet.")

    return WritePlan(
        action="update" if found is not None else "create",
        company_id=found.id if found is not None else None,
        company_name=(found.text("name") if found is not None else None) or request.company.name,
        company_url=found.url if found is not None else None,
        domain=normalize_domain(request.company.domain),
        fields=changes,
        note=_note_text(request.note, changes),
        list_name=request.list_name,
        list_id=list_id,
        warnings=warnings,
    )


def _note_text(note: str | None, changes: Sequence[FieldChange]) -> str | None:
    """The note, with the values that couldn't go in a field added at the end."""
    lines = [note.strip()] if note and note.strip() else []
    moved = [c for c in changes if not c.write and c.current is None]
    if moved:
        lines.append("")
        lines += [f"{change.label}: {change.value}" for change in moved]
    text = "\n".join(lines).strip()
    return text[:NOTE_MAX_CHARS] or None


async def preview_write(session: AsyncSession, hubspot: HubSpot, request: WriteRequest) -> WriteOut:
    """Saves (or refreshes) the subject's one open write as a preview. A subject already sent,
    or being written, or part-written, gets that write back unchanged."""
    existing = await session.scalar(
        select(HubSpotWrite)
        .where(HubSpotWrite.app == request.app, HubSpotWrite.subject == request.subject)
        .where(HubSpotWrite.status.in_(("done", "writing", *CONTINUE, *OPEN)))
        .order_by(HubSpotWrite.created_at.desc())
        .limit(1)
    )
    if existing is not None and existing.status not in OPEN:
        return write_out(existing)
    plan = await plan_write(hubspot, request)
    if existing is None:
        existing = HubSpotWrite(app=request.app, subject=request.subject, plan={})
        session.add(existing)
    existing.plan = plan.model_dump(mode="json")
    existing.status = "previewed"
    existing.result = {}
    existing.error = None
    existing.hubspot_company_id = plan.company_id
    existing.hubspot_url = plan.company_url
    existing.created_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(existing)
    return write_out(existing)


# --- Write -----------------------------------------------------------------------------------


async def get_write(session: AsyncSession, write_id: uuid.UUID) -> HubSpotWrite:
    row = await session.get(HubSpotWrite, write_id)
    if row is None:
        raise WriteNotFound(str(write_id))
    return row


async def apply_write(
    session: AsyncSession,
    hubspot: HubSpot,
    write_id: uuid.UUID,
    *,
    on_written: OnWritten | None = None,
) -> WriteOut:
    """Writes a previewed plan, step by step. A finished write is returned as it is."""
    row = await get_write(session, write_id)
    if row.status == "done":
        return write_out(row)
    if row.status == "writing":
        raise WriteInProgress(str(write_id))
    if not getattr(hubspot, "writes_allowed", False):
        raise HubSpotWritesOff
    claimed = await _claim(session, row)
    plan = WritePlan.model_validate(claimed.plan)
    steps = {step.step: step for step in _steps(claimed)}
    company_id = claimed.hubspot_company_id

    company_step = steps.get("company")
    if company_step is None or company_step.status != "done":
        result, company_id, url = await _company_step(hubspot, plan, company_step)
        steps["company"] = result
        if url:
            claimed.hubspot_url = url
        claimed.hubspot_company_id = company_id
        await _save_steps(session, claimed, steps)
        if result.status == "done" and company_id:
            await _refresh_copy(session, hubspot, company_id)

    if company_id and steps["company"].status == "done":
        if plan.note and steps.get("note", _pending("note")).status in ("failed", "skipped"):
            steps["note"] = await _note_step(hubspot, plan, company_id)
            await _save_steps(session, claimed, steps)
        if plan.list_id and steps.get("list", _pending("list")).status != "done":
            steps["list"] = await _list_step(hubspot, plan.list_id, company_id)
            await _save_steps(session, claimed, steps)
        if plan.list_name and not plan.list_id:
            steps["list"] = StepResult(
                step="list", status="skipped", detail=f"The list '{plan.list_name}' isn't ready."
            )

    status = _status_of(steps.values())
    claimed.status = status
    claimed.finished_at = datetime.now(UTC)
    claimed.error = _error_of(steps.values())
    claimed.result = {"steps": [step.model_dump() for step in steps.values()]}
    await session.commit()
    await session.refresh(claimed)
    out = write_out(claimed)
    if on_written is not None and status == "done":
        await on_written(session, out)
    return out


def _pending(step: StepName) -> StepResult:
    return StepResult(step=step, status="skipped")


def _steps(row: HubSpotWrite) -> list[StepResult]:
    return [StepResult.model_validate(step) for step in (row.result or {}).get("steps", [])]


async def _claim(session: AsyncSession, row: HubSpotWrite) -> HubSpotWrite:
    """Marks the write as being written, so a second click or a second tab can't write too."""
    try:
        result = await session.execute(
            update(HubSpotWrite)
            .where(HubSpotWrite.id == row.id, HubSpotWrite.status.in_((*OPEN, *CONTINUE)))
            .values(status="writing", applied_at=datetime.now(UTC))
            .returning(HubSpotWrite.id)
        )
        claimed = result.first()
        await session.commit()
    except IntegrityError as error:  # another write for the same subject is being written
        await session.rollback()
        raise WriteInProgress(str(row.id)) from error
    if claimed is None:  # another click claimed it, or finished it, between the read and now
        raise WriteInProgress(str(row.id))
    await session.refresh(row)
    return row


async def _save_steps(
    session: AsyncSession, row: HubSpotWrite, steps: Mapping[StepName, StepResult]
) -> None:
    row.result = {"steps": [step.model_dump() for step in steps.values()]}
    await session.commit()


def _failed(step: StepName, error: HubSpotError) -> StepResult:
    status: StepStatus = "uncertain" if isinstance(error, HubSpotWriteUncertain) else "failed"
    return StepResult(step=step, status=status, detail=scrub(f"{error.title}. {error.detail}"))


async def _company_step(
    hubspot: HubSpot, plan: WritePlan, before: StepResult | None
) -> tuple[StepResult, str | None, str | None]:
    """Makes the company, or fills its empty fields. Reads it again first (rule 3)."""
    wanted = {change.property: change.value for change in plan.fields if change.write}
    target = CompanyTarget(hubspot_id=plan.company_id, name=plan.company_name, domain=plan.domain)
    try:
        found, _ = await find_company(hubspot, target, ["name", "domain", *wanted])
        if found is not None:
            empty = {name: value for name, value in wanted.items() if found.text(name) is None}
            if empty:
                await hubspot.update_object("companies", found.id, empty)
            kept = sorted(set(wanted) - set(empty))
            detail = f"Filled {len(empty)} empty fields."
            if kept:
                detail += f" Kept {len(kept)} that have a value now: {', '.join(kept)}."
            return (
                StepResult(step="company", status="done", detail=detail, hubspot_id=found.id),
                found.id,
                found.url,
            )
        if before is not None and before.status == "uncertain":
            # It may have been made before the timeout, but a search can't find it yet.
            return (
                StepResult(
                    step="company",
                    status="uncertain",
                    detail="The last try may have made it. Check HubSpot before trying again.",
                ),
                None,
                None,
            )
        properties = {"name": plan.company_name, **wanted}
        if plan.domain:
            properties.setdefault("domain", plan.domain)
        made = await hubspot.create_object("companies", properties)
        return (
            StepResult(
                step="company", status="done", detail="Made a new company.", hubspot_id=made.id
            ),
            made.id,
            made.url,
        )
    except HubSpotError as error:
        return _failed("company", error), None, None


async def _note_step(hubspot: HubSpot, plan: WritePlan, company_id: str) -> StepResult:
    body = note_html(plan.note or "")
    timestamp = str(int(datetime.now(UTC).timestamp() * 1000))
    try:
        made = await hubspot.create_object(
            "notes",
            {"hs_note_body": body, "hs_timestamp": timestamp},
            associate_with_company=company_id,
        )
    except HubSpotWriteUncertain as error:
        result = _failed("note", error)
        result.detail = (result.detail or "") + " It is not sent again, so it can't be doubled."
        return result
    except HubSpotError as error:
        return _failed("note", error)
    return StepResult(step="note", status="done", detail="Added the note.", hubspot_id=made.id)


async def _list_step(hubspot: HubSpot, list_id: str, company_id: str) -> StepResult:
    try:
        await hubspot.add_to_list(list_id, [company_id])  # adding a member twice changes nothing
    except HubSpotError as error:
        return _failed("list", error)
    return StepResult(step="list", status="done", detail="Added to the list.", hubspot_id=list_id)


def _status_of(steps: Sequence[StepResult] | Any) -> WriteStatus:
    found = list(steps)
    states = {step.status for step in found}
    if "uncertain" in states:
        return "uncertain"
    done = [step for step in found if step.status == "done"]
    if done and len(done) == len([s for s in found if s.status != "skipped"]):
        return "done"
    return "partial" if done else "failed"


def _error_of(steps: Any) -> str | None:
    problems = [
        f"{step.step}: {step.detail}" for step in steps if step.status in ("failed", "uncertain")
    ]
    return " ".join(problems) or None


_URL = re.compile(r"https?://[^\s<>\"']+")


def note_html(text: str) -> str:
    """HubSpot's note body is HTML. Every line becomes a paragraph, each web address a link,
    and everything else is escaped, so a note can never carry markup of its own."""
    paragraphs: list[str] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        out, last = [], 0
        for match in _URL.finditer(line):
            out.append(html.escape(line[last : match.start()]))
            url = html.escape(match.group(0), quote=True)
            out.append(f'<a href="{url}">{url}</a>')
            last = match.end()
        out.append(html.escape(line[last:]))
        paragraphs.append(f"<p>{''.join(out)}</p>")
    return "".join(paragraphs)


async def _refresh_copy(session: AsyncSession, hubspot: HubSpot, company_id: str) -> None:
    """Saves HubSpot's record of the company into our copy at once. A failure here is logged,
    never raised: the write itself landed, and the next sync catches up."""
    try:
        fields = load_field_map()
        record = await hubspot.get_object(
            "companies", company_id, properties=fields.company_properties()
        )
        if record is None:
            return
        definitions = await hubspot.properties("companies")
        owners = (await session.execute(select(HubSpotOwner.owner_id, HubSpotOwner.name))).all()
        convert = Converter(
            Lookups.build(
                owners=[(row[0], row[1]) for row in owners],
                pipelines=[],
                company_fields=[d for d in definitions if d.choices],
                time_zone=None,
            ),
            Problems(),
        )
        rows = company_rows(record, fields, convert)
        await upsert_companies(session, [rows.company], source="api")
        await replace_offices(session, [company_id], rows.offices)
        await session.commit()
    except (HubSpotError, HubSpotNotFound):
        log.warning("hubspot_copy_not_refreshed", extra={"company_id": company_id})
        await session.rollback()
    except Exception:
        log.exception("hubspot_copy_not_refreshed", extra={"company_id": company_id})
        await session.rollback()


async def recent_writes(session: AsyncSession, limit: int = 50) -> list[WriteOut]:
    rows = await session.scalars(
        select(HubSpotWrite)
        .where(HubSpotWrite.status != "previewed")
        .order_by(HubSpotWrite.created_at.desc())
        .limit(limit)
    )
    return [write_out(row) for row in rows]
