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
   that was sent returns the first write. Two previews at the same moment take turns to save
   (`lock_subject`), so the second finds the first's row and never makes another. A write that
   timed out is never sent again blind: a company is looked for by domain or name first, and a
   note that may have landed is not sent again (the log says to check HubSpot).
4. Our copy of the company is updated at once after it is written, so pages show it.
5. **Shared with the activity writer** (PLAN-V17 T1-5, `activities.py`: a call, field changes,
   tasks and a note) and a task's status (PLAN-V22 T1-4, `tasks.py`: Done and reopen): the one
   open write per subject (`latest_write`, `save_preview`), the claim (`claim_write`,
   `take_over_write`, `Claim`), the step log (`steps_of`, `steps_json`, `save_steps`,
   `failed_step`, `status_of`, `error_of`), `note_html`, `choice_code`, `refresh_copy` and the
   `core.hubspot_writes` table. One log for all three. A plan's `kind` says which writer made a
   row, and each writer refuses the others' rows.

It is off unless `HUBSPOT_WRITE_ENABLED=true` (`HubSpotWritesOff`, "Waiting for write access").
"""

import html
import logging
import re
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ColumnElement, and_, func, select, text, update
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
    Link,
    PropertyInfo,
)
from core.hubspot.importer import normalize_domain
from core.hubspot.mapping import Converter, Lookups, Problems, company_rows, load_field_map
from core.hubspot.models import HubSpotOwner, HubSpotWrite
from core.hubspot.service import replace_offices, upsert_companies
from core.logs import scrub

log = logging.getLogger(__name__)

StepName = Literal["company", "note", "list"]  # the Lead Finder's steps
# Every step's name, as text with a pattern, so old rows and new ones read the same way: the Lead
# Finder's; an activity's (PLAN-V17): call, fields, task:1 ..., note, meeting; and a task's status
# (PLAN-V22 T1-4): status.
STEP_NAME = r"^(?:company|note|list|call|fields|task:[1-9][0-9]*|meeting|status)$"
StepStatus = Literal["done", "failed", "uncertain", "skipped"]
WriteStatus = Literal["previewed", "writing", "done", "partial", "failed", "uncertain"]
PlanKind = Literal["company", "activity", "task"]
OPEN = ("previewed", "failed")  # a new preview may plan these again
CONTINUE = ("partial", "uncertain")  # applying again finishes these
NOTE_MAX_CHARS = 60_000  # HubSpot's note body limit is 65,536
WRITE_OFF = "Waiting for write access"
# Two previews of one subject take turns to save (`lock_subject`): a Postgres advisory lock in
# the two-key form, this number and hashtext("<app>:<subject>"). 7_244_411 rebuilds the
# profiles; core/prefs/service.py lists the other keys.
PREVIEW_LOCK = 7_244_412

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
    seen: str | None = Field(
        None,
        description=(
            "An activity's field: the value the rep saw, in HubSpot's own form. null: the rep "
            "saw it empty, or a Lead Finder write"
        ),
    )
    changed_since: bool = Field(
        False,
        description=(
            "An activity's field: HubSpot's value is not what the rep saw. A field held at the "
            "write (HubSpot changed it since the preview) has this, with write false"
        ),
    )


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
    kind: PlanKind = Field(
        "company",
        description=(
            "company: the Lead Finder's send (a company, a note, a list). activity: a call, "
            "field changes, follow-up tasks and a note on one company (PLAN-V17). task: one "
            "task ticked done or opened again (PLAN-V22)"
        ),
    )
    contact_id: str | None = Field(None, description="An activity's person in HubSpot")
    deal_id: str | None = Field(None, description="An activity's deal in HubSpot")
    owner_id: str | None = Field(
        None, description="The rep's HubSpot owner id. null: HubSpot shows it as unassigned"
    )
    call: str | None = Field(None, description="The call in words: its title, outcome and time")
    tasks: list[str] = Field(
        default_factory=list,
        description="Each follow-up task in words: what, when it is due, and for whom",
    )
    meeting_id: str | None = Field(
        None, description="An activity's meeting in HubSpot: the one its note is about"
    )
    meeting: str | None = Field(
        None,
        description=(
            "What the note adds to the meeting, in words. null: the meeting isn't changed (no "
            "meeting, or adding notes to meetings is switched off)"
        ),
    )


class StepResult(BaseModel):
    step: str = Field(
        pattern=STEP_NAME,
        description=(
            "company, note or list (the Lead Finder); call, fields, task:1, task:2 ..., note or "
            "meeting (an activity); status (a task ticked done or opened again)"
        ),
        examples=["task:1"],
    )
    status: StepStatus
    detail: str | None = None
    hubspot_id: str | None = None
    held: list[str] = Field(
        default_factory=list,
        description=(
            "The fields step: HubSpot's names of the fields not written because HubSpot "
            "changed them since the preview"
        ),
    )


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


def choice_code(info: PropertyInfo, value: str) -> str | None:
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
            code = choice_code(info, value)
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
    existing = await latest_write(session, request.app, request.subject)
    if existing is not None and existing.status not in OPEN:
        return write_out(existing)
    existing_id = existing.id if existing is not None else None
    plan = await plan_write(hubspot, request)
    row = await save_preview(
        session,
        existing_id,
        app=request.app,
        subject=request.subject,
        plan=plan.model_dump(mode="json"),
        company_id=plan.company_id,
        url=plan.company_url,
    )
    return write_out(row)


async def latest_write(session: AsyncSession, app: str, subject: str) -> HubSpotWrite | None:
    """The subject's newest write: one open write per subject (like one lead, or one call
    note's send). A preview plans it again only while it is previewed or failed."""
    found: HubSpotWrite | None = await session.scalar(
        select(HubSpotWrite)
        .where(HubSpotWrite.app == app, HubSpotWrite.subject == subject)
        .where(HubSpotWrite.status.in_(("done", "writing", *CONTINUE, *OPEN)))
        .order_by(HubSpotWrite.created_at.desc())
        .limit(1)
    )
    return found


async def save_preview(
    session: AsyncSession,
    write_id: uuid.UUID | None,
    *,
    app: str,
    subject: str,
    plan: dict[str, Any],
    company_id: str | None,
    url: str | None,
) -> HubSpotWrite:
    """Saves a subject's open write as "previewed": the write `write_id` planned again, or a new
    one. Two previews of one subject take turns here (`lock_subject`), and one that found no
    write looks again first: if the other preview made the subject's write meanwhile, that write
    is planned again, so a subject never gets a second row. If a click claimed or finished the
    write meanwhile, it comes back as it is."""
    values: dict[str, Any] = {
        "plan": plan,
        "status": "previewed",
        "result": {},
        "error": None,
        "hubspot_company_id": company_id,
        "hubspot_url": url,
        "created_at": datetime.now(UTC),
    }
    await lock_subject(session, app, subject)  # held until the commit below
    if write_id is None:
        made = await latest_write(session, app, subject)
        write_id = made.id if made is not None else None
    if write_id is None:
        row = HubSpotWrite(app=app, subject=subject, **values)
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row
    await session.execute(
        update(HubSpotWrite)
        .where(HubSpotWrite.id == write_id, HubSpotWrite.status.in_(OPEN))
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    saved = await session.get(HubSpotWrite, write_id, populate_existing=True)
    if saved is None:  # removed meanwhile: nothing removes writes today
        raise WriteNotFound(str(write_id))
    return saved


async def lock_subject(session: AsyncSession, app: str, subject: str) -> None:
    """Waits while another preview of this subject saves, then holds the turn until this
    transaction ends (a Postgres advisory lock). Only the short save holds it: no database
    connection waits on HubSpot with it."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(CAST(:space AS integer), hashtext(:key))"),
        {"space": PREVIEW_LOCK, "key": f"{app}:{subject}"},
    )


# --- Write -----------------------------------------------------------------------------------


async def get_write(session: AsyncSession, write_id: uuid.UUID) -> HubSpotWrite:
    """The write as the table has it now, even when this session read it before (another click
    or apply may have changed it since)."""
    row = await session.get(HubSpotWrite, write_id, populate_existing=True)
    if row is None:
        raise WriteNotFound(str(write_id))
    return row


def is_activity(row: HubSpotWrite) -> bool:
    """Whether the activity writer made this row (PLAN-V17). Only `apply_activity` writes it."""
    return (row.plan or {}).get("kind") == "activity"


def is_company(row: HubSpotWrite) -> bool:
    """Whether the Lead Finder's writer made this row: its plan's kind is company, or it has none
    (a row saved before kinds). Only `apply_write` writes it."""
    kind: object = (row.plan or {}).get("kind", "company")
    return kind == "company"


async def apply_write(
    session: AsyncSession,
    hubspot: HubSpot,
    write_id: uuid.UUID,
    *,
    on_written: OnWritten | None = None,
) -> WriteOut:
    """Writes a previewed plan, step by step. A finished write is returned as it is."""
    row = await get_write(session, write_id)
    if not is_company(row):  # a call note's write or a task's status: their own writers
        raise WriteNotFound(str(write_id))
    if row.status == "done":
        return write_out(row)
    if row.status == "writing":
        raise WriteInProgress(str(write_id))
    if not getattr(hubspot, "writes_allowed", False):
        raise HubSpotWritesOff
    claimed = await claim_write(session, row)
    plan = WritePlan.model_validate(claimed.plan)
    steps = {step.step: step for step in steps_of(claimed)}
    company_id = claimed.hubspot_company_id

    company_step = steps.get("company")
    if company_step is None or company_step.status != "done":
        result, company_id, url = await _company_step(hubspot, plan, company_step)
        steps["company"] = result
        if url:
            claimed.hubspot_url = url
        claimed.hubspot_company_id = company_id
        await save_steps(session, claimed, steps)
        if result.status == "done" and company_id:
            await refresh_copy(session, hubspot, company_id)

    if company_id and steps["company"].status == "done":
        if plan.note and steps.get("note", _pending("note")).status in ("failed", "skipped"):
            steps["note"] = await _note_step(hubspot, plan, company_id)
            await save_steps(session, claimed, steps)
        if plan.list_id and steps.get("list", _pending("list")).status != "done":
            steps["list"] = await _list_step(hubspot, plan.list_id, company_id)
            await save_steps(session, claimed, steps)
        if plan.list_name and not plan.list_id:
            steps["list"] = StepResult(
                step="list", status="skipped", detail=f"The list '{plan.list_name}' isn't ready."
            )

    status = status_of(steps.values())
    claimed.status = status
    claimed.finished_at = datetime.now(UTC)
    claimed.error = error_of(steps.values())
    claimed.result = steps_json(steps.values())
    await session.commit()
    await session.refresh(claimed)
    out = write_out(claimed)
    if on_written is not None and status == "done":
        await on_written(session, out)
    return out


def _pending(step: StepName) -> StepResult:
    return StepResult(step=step, status="skipped")


# --- The claim and the step log (shared with activities.py) ----------------------------------


def steps_of(row: HubSpotWrite) -> list[StepResult]:
    """Each step's result, as saved."""
    return [StepResult.model_validate(step) for step in (row.result or {}).get("steps", [])]


def steps_json(steps: Iterable[StepResult]) -> dict[str, Any]:
    """The step log as the table keeps it (`result`)."""
    return {"steps": [step.model_dump() for step in steps]}


async def claim_write(session: AsyncSession, row: HubSpotWrite) -> HubSpotWrite:
    """Marks the write as being written, so a second click or a second tab can't write too."""
    return await _claim_where(session, row, HubSpotWrite.status.in_((*OPEN, *CONTINUE)))


async def take_over_write(
    session: AsyncSession, row: HubSpotWrite, *, stalled_before: datetime
) -> HubSpotWrite:
    """Claims a write left "writing" by an apply that stopped part way (PLAN-V17 T1-5): only
    while its claim hasn't been kept since `stalled_before`. A live one raises `WriteInProgress`."""
    kept = func.coalesce(HubSpotWrite.applied_at, HubSpotWrite.created_at)
    stalled = and_(HubSpotWrite.status == "writing", kept < stalled_before)
    return await _claim_where(session, row, stalled)


async def _claim_where(
    session: AsyncSession, row: HubSpotWrite, allowed: ColumnElement[bool]
) -> HubSpotWrite:
    """The claim: the row becomes "writing", with `applied_at` now, only when `allowed` holds.
    The row comes back as saved, and no database connection is held after it (HubSpot comes
    next)."""
    try:
        result = await session.execute(
            update(HubSpotWrite)
            .where(HubSpotWrite.id == row.id, allowed)
            .values(status="writing", applied_at=datetime.now(UTC))
            .returning(HubSpotWrite.id)
            .execution_options(synchronize_session=False)
        )
        claimed = result.first() is not None
        if claimed:
            await session.refresh(row)
        await session.commit()
    except IntegrityError as error:  # another write for the same subject is being written
        await session.rollback()
        raise WriteInProgress(str(row.id)) from error
    if not claimed:  # another click claimed it, or finished it, between the read and now
        raise WriteInProgress(str(row.id))
    return row


@dataclass
class Claim:
    """One apply's hold on a write it claimed (PLAN-V17 T1-5). `mark` is the `applied_at` this
    apply wrote last. Each save moves it on, so a write still going is never taken for one that
    stopped. A save lands only while the row is still "writing" with this mark: an apply whose
    write was taken over stops before it sends anything else."""

    write_id: uuid.UUID
    mark: datetime

    @classmethod
    def of(cls, row: HubSpotWrite) -> "Claim":
        if row.applied_at is None:  # never after `claim_write` or `take_over_write`
            raise WriteInProgress(str(row.id))
        return cls(row.id, row.applied_at)

    async def save(self, session: AsyncSession, values: Mapping[str, Any]) -> None:
        """Saves `values` (the step log, a status ...) and keeps the claim. Raises
        `WriteInProgress` when another apply holds the write now."""
        now = datetime.now(UTC)
        result = await session.execute(
            update(HubSpotWrite)
            .where(
                HubSpotWrite.id == self.write_id,
                HubSpotWrite.status == "writing",
                HubSpotWrite.applied_at == self.mark,
            )
            .values(**values, applied_at=now)
            .returning(HubSpotWrite.id)
            .execution_options(synchronize_session=False)
        )
        kept = result.first() is not None
        await session.commit()
        if not kept:
            raise WriteInProgress(str(self.write_id))
        self.mark = now


async def save_steps(
    session: AsyncSession, row: HubSpotWrite, steps: Mapping[str, StepResult]
) -> None:
    """Saves each step's result as it lands."""
    row.result = steps_json(steps.values())
    await session.commit()


def failed_step(step: str, error: HubSpotError) -> StepResult:
    """A step HubSpot refused (failed), or didn't answer (uncertain), in its own plain words."""
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
        return failed_step("company", error), None, None


async def _note_step(hubspot: HubSpot, plan: WritePlan, company_id: str) -> StepResult:
    body = note_html(plan.note or "")
    timestamp = str(int(datetime.now(UTC).timestamp() * 1000))
    try:
        made = await hubspot.create_object(
            "notes",
            {"hs_note_body": body, "hs_timestamp": timestamp},
            links=[Link("companies", company_id)],
        )
    except HubSpotWriteUncertain as error:
        result = failed_step("note", error)
        result.detail = (result.detail or "") + " It is not sent again, so it can't be doubled."
        return result
    except HubSpotError as error:
        return failed_step("note", error)
    return StepResult(step="note", status="done", detail="Added the note.", hubspot_id=made.id)


async def _list_step(hubspot: HubSpot, list_id: str, company_id: str) -> StepResult:
    try:
        await hubspot.add_to_list(list_id, [company_id])  # adding a member twice changes nothing
    except HubSpotError as error:
        return failed_step("list", error)
    return StepResult(step="list", status="done", detail="Added to the list.", hubspot_id=list_id)


def status_of(steps: Iterable[StepResult]) -> WriteStatus:
    """A write's status from its steps: any uncertain, uncertain; every step that ran done,
    done; some done, partial; none, failed. A skipped step had nothing to do."""
    found = list(steps)
    states = {step.status for step in found}
    if "uncertain" in states:
        return "uncertain"
    done = [step for step in found if step.status == "done"]
    if done and len(done) == len([s for s in found if s.status != "skipped"]):
        return "done"
    return "partial" if done else "failed"


def error_of(steps: Iterable[StepResult]) -> str | None:
    """The failed and uncertain steps, in plain words, for the write's `error`."""
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


async def refresh_copy(session: AsyncSession, hubspot: HubSpot, company_id: str) -> None:
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
