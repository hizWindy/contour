"""Draws the database schema from the live database into engine/schema/SCHEMA-<migration>.md.

From engine/backend, after every migration:

    uv run --no-sync python scripts/schema_map.py

The file is named after the migration the database is at, like SCHEMA-0008.md, so the same
name always means the same schema. The newest number is the current one. Each file has a
diagram (Mermaid, which GitHub, Obsidian and Notion draw), every table with its columns, keys,
indexes and checks, and what changed since the file before it.

It reads the shape of the database only: never a row, and no counts, so a file changes only when
the schema does. The connection is read only. `--check` writes nothing: it fails when the saved
file for this migration is missing or no longer matches the database, which means a table was
changed outside a migration.
"""

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg

from core.config import ENGINE_DIR, get_settings

OUT_DIR = ENGINE_DIR / "schema"
SCHEMA_ORDER = ("core", "lead_finder", "langgraph")
DIAGRAM_SKIP = frozenset({"langgraph"})  # the library's own tables, not ours to draw
DELETE_RULES = {"a": "", "r": "restrict", "c": "cascade", "n": "set null", "d": "set default"}

SCHEMA_NOTES = {
    "core": "Shared by every project.",
    "lead_finder": "The Lead Finder only.",
    "langgraph": (
        "LangGraph's own checkpoint tables. LangGraph creates and updates them, not our migrations."
    ),
}

# What each table is for. Written by hand: a table that is missing here shows "(no description
# yet)" and the script says so, so a new table gets a line when it is added.
PURPOSE = {
    "core.runs": "One row per research run: its kind, status, settings, caps and cost.",
    "core.run_events": "The ordered event log of a run, which is what the live run page shows.",
    "core.searches": "The search log: every Claude request, with its tokens, sources and cost.",
    "core.memory": "Saved notes with a vector, for finding similar companies (pgvector).",
    "core.settings": "The settings changed on the Settings page: a key and a JSON value.",
    "core.users": (
        "The people who may sign in: the login names, the password's argon2id hash, and the "
        "count of wrong tries and the lock. One Admin today."
    ),
    "core.sessions": (
        "One row for each signed-in browser. Only a hash of the cookie's token is kept, so a "
        "copy of the database can't be used to sign in."
    ),
    "core.audit_log": (
        "The sign-in log: every sign-in, failure, lock, sign-out and password change, with the "
        "time and the IP address. Never a password or a token."
    ),
    "core.hubspot_companies": (
        "Our copy of HubSpot's companies, from the sync (source api) or an export upload "
        "(source export)."
    ),
    "core.hubspot_offices": (
        "One row per office of a HubSpot company. In HubSpot these are company fields, one "
        "group per city, so an office is replaced with its company."
    ),
    "core.hubspot_deals": "HubSpot deals: the stage label, the pipeline, amount and close date.",
    "core.hubspot_owners": "HubSpot users who own records: the id and name only, never an email.",
    "core.hubspot_syncs": (
        "One row per HubSpot sync: full or changes only, what it read and saved, and any error. "
        "Only one can be running."
    ),
    "core.hubspot_writes": (
        "Every write to HubSpot a person asked for: the plan they saw, each step's result. The "
        "id is the write's key, so it is written once only."
    ),
    "lead_finder.leads": (
        "One row per researched company. `card` holds the whole lead card. The other columns "
        "are copies, for filtering and sorting."
    ),
    "lead_finder.signalhire_details": (
        "Signal Hire's company record, saved so a company is paid for once a month."
    ),
    "langgraph.checkpoints": "A saved point in a run's graph, so a stopped run can continue.",
    "langgraph.checkpoint_blobs": "Large values that belong to a checkpoint.",
    "langgraph.checkpoint_writes": "The pending writes of a checkpoint step.",
    "langgraph.checkpoint_migrations": "The version of LangGraph's own tables.",
}

# Short notes on columns whose name doesn't say enough.
COLUMN_NOTES = {
    "core.users.email": "Saved in lower case, so it is compared in lower case.",
    "core.users.username": "Lower case, no @, or empty. A second way to sign in.",
    "core.users.password_hash": "argon2id, with its own settings in the text. Never the password.",
    "core.users.failed_attempts": "Wrong tries in a row. A right password sets it back to 0.",
    "core.users.locked_until": "No sign-in before this time: a growing wait, then 15 minutes.",
    "core.sessions.token_hash": "SHA-256 (hex) of the random token in the cookie. Never the token.",
    "core.sessions.expires_at": "The longest it lasts: 12 hours, or 14 days if kept signed in.",
    "core.sessions.remember": "Keep me signed in. Such a session has no idle limit.",
    "core.audit_log.details": "Facts about the entry. Never a password, a token or a typed login.",
    "lead_finder.leads.card": "Everything on the lead card: facts, sources and rule checks.",
    "core.hubspot_companies.source": '"api" from the sync, "export" from an upload.',
    "core.hubspot_deals.stage": "The stage's label from its pipeline, never guessed from the id.",
    "core.hubspot_writes.subject": 'What the write is about, like "lead:<id>".',
    "core.hubspot_companies.state_raw": "The state as typed in HubSpot.",
}

# Columns that hold another table's key but have no foreign key, so nothing in the database
# enforces them. Written by hand, because the database can't tell us. (child, parent, why)
SOFT_LINKS = (
    (
        "lead_finder.leads.hubspot_id",
        "core.hubspot_companies.hubspot_id",
        "by design: a HubSpot record can be merged or deleted in HubSpot",
    ),
    ("core.searches.run_id", "core.runs.id", ""),
    (
        "core.hubspot_companies.owner_id",
        "core.hubspot_owners.owner_id",
        "HubSpot's owner list may lack an id, and one bad row must not stop a sync",
    ),
    ("core.hubspot_deals.owner_id", "core.hubspot_owners.owner_id", "the same reason"),
)

INTERNAL = "('pg_catalog', 'information_schema', 'pg_toast', 'public')"
COLUMNS_SQL = f"""
select n.nspname, c.relname, a.attname::text, format_type(a.atttypid, a.atttypmod), not a.attnotnull
from pg_attribute a
join pg_class c on c.oid = a.attrelid and c.relkind in ('r', 'p')
join pg_namespace n on n.oid = c.relnamespace
where a.attnum > 0 and not a.attisdropped and n.nspname not in {INTERNAL}
order by n.nspname, c.relname, a.attnum
"""
PRIMARY_KEYS_SQL = f"""
select n.nspname, c.relname, a.attname::text
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
where i.indisprimary and n.nspname not in {INTERNAL}
"""
FOREIGN_KEYS_SQL = f"""
select cn.nspname, cc.relname, rn.nspname, rc.relname,
       array_agg(a.attname::text order by k.ord), array_agg(ra.attname::text order by k.ord),
       bool_and(a.attnotnull), con.confdeltype::text
from pg_constraint con
join pg_class cc on cc.oid = con.conrelid
join pg_namespace cn on cn.oid = cc.relnamespace
join pg_class rc on rc.oid = con.confrelid
join pg_namespace rn on rn.oid = rc.relnamespace
cross join lateral unnest(con.conkey, con.confkey) with ordinality as k(attnum, fattnum, ord)
join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = k.fattnum
where con.contype = 'f' and cn.nspname not in {INTERNAL}
group by con.oid, cn.nspname, cc.relname, rn.nspname, rc.relname, con.confdeltype
"""
INDEXES_SQL = f"""
select n.nspname, c.relname, ic.relname, pg_get_indexdef(i.indexrelid), i.indisunique
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_class ic on ic.oid = i.indexrelid
where not i.indisprimary and n.nspname not in {INTERNAL}
order by 1, 2, 3
"""
CHECKS_SQL = f"""
select n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where con.contype = 'c' and n.nspname not in {INTERNAL}
order by 1, 2, 3
"""


@dataclass
class Column:
    type: str
    null: bool
    key: str = ""  # "PK", "FK -> core.runs.id (cascade)", "soft -> core.runs.id"
    note: str = ""
    pk: bool = False
    fk: bool = False
    soft: bool = False


@dataclass
class Table:
    purpose: str = ""
    columns: dict[str, Column] = field(default_factory=dict)
    indexes: dict[str, str] = field(default_factory=dict)
    checks: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Link:
    child: str  # "core.run_events"
    child_columns: tuple[str, ...]
    parent: str
    parent_columns: tuple[str, ...]
    soft: bool  # no foreign key, nothing enforces it
    optional: bool  # the child column can be empty
    on_delete: str


@dataclass
class Snapshot:
    revision: str
    database: str
    extensions: list[str]
    tables: dict[str, Table]
    links: list[Link]
    warnings: list[str] = field(default_factory=list)


# --- Reading the database -----------------------------------------------------------------


def query(conn: psycopg.Connection[tuple[Any, ...]], sql: str) -> list[tuple[Any, ...]]:
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def pretty_type(raw: str) -> str:
    return (
        raw.replace("character varying", "varchar")
        .replace("timestamp with time zone", "timestamptz")
        .replace("timestamp without time zone", "timestamp")
        .replace("double precision", "float8")
    )


def short_index(definition: str, unique: bool) -> str:
    """'CREATE INDEX x ON s.t USING btree (a)' becomes 'btree (a)', with 'unique ' in front."""
    text = definition.partition(" USING ")[2] or definition
    return f"unique {text}" if unique else text


def short_check(definition: str) -> str:
    """Drops the type casts Postgres adds, like ::text, so the rule reads as it was written."""
    text = re.sub(r"::[a-z]+(?: [a-z]+)*(?:\[\])?", "", definition)
    return text.removeprefix("CHECK ").strip()


def read_database() -> Snapshot:
    settings = get_settings()
    with psycopg.connect(settings.psycopg_conninfo()) as conn:
        conn.read_only = True
        try:
            revision = str(query(conn, "select version_num from public.alembic_version")[0][0])
        except (psycopg.errors.UndefinedTable, IndexError) as error:
            raise SystemExit(
                "The database has no migration yet. Run `uv run engine migrate`."
            ) from error
        columns = query(conn, COLUMNS_SQL)
        primary_keys = query(conn, PRIMARY_KEYS_SQL)
        foreign_keys = query(conn, FOREIGN_KEYS_SQL)
        indexes = query(conn, INDEXES_SQL)
        checks = query(conn, CHECKS_SQL)
        extensions = [
            row[0]
            for row in query(
                conn, "select extname from pg_extension where extname <> 'plpgsql' order by 1"
            )
        ]

    tables: dict[str, Table] = {}
    for schema, table, name, kind, nullable in columns:
        full = f"{schema}.{table}"
        entry = tables.setdefault(full, Table(purpose=PURPOSE.get(full, "")))
        entry.columns[name] = Column(
            type=pretty_type(kind), null=bool(nullable), note=COLUMN_NOTES.get(f"{full}.{name}", "")
        )
    for schema, table, name in primary_keys:
        tables[f"{schema}.{table}"].columns[name].pk = True
    for schema, table, name, definition, unique in indexes:
        tables[f"{schema}.{table}"].indexes[name] = short_index(definition, bool(unique))
    for schema, table, name, definition in checks:
        tables[f"{schema}.{table}"].checks[name] = short_check(definition)

    links: list[Link] = []
    for (
        child_schema,
        child,
        parent_schema,
        parent,
        child_cols,
        parent_cols,
        not_null,
        rule,
    ) in foreign_keys:
        link = Link(
            child=f"{child_schema}.{child}",
            child_columns=tuple(child_cols),
            parent=f"{parent_schema}.{parent}",
            parent_columns=tuple(parent_cols),
            soft=False,
            optional=not not_null,
            on_delete=DELETE_RULES.get(rule, ""),
        )
        links.append(link)
        for child_col, parent_col in zip(link.child_columns, link.parent_columns, strict=True):
            column = tables[link.child].columns[child_col]
            column.fk = True
            target = f"{link.parent}.{parent_col}"
            column.key = (
                f"FK -> {target} ({link.on_delete})" if link.on_delete else f"FK -> {target}"
            )

    warnings: list[str] = []
    for child_path, parent_path, why in SOFT_LINKS:
        child_table, _, child_col = child_path.rpartition(".")
        parent_table, _, parent_col = parent_path.rpartition(".")
        if (
            child_col not in tables.get(child_table, Table()).columns
            or parent_col not in tables.get(parent_table, Table()).columns
        ):
            warnings.append(
                f"The soft link {child_path} -> {parent_path} no longer matches a column."
            )
            continue
        links.append(Link(child_table, (child_col,), parent_table, (parent_col,), True, True, ""))
        column = tables[child_table].columns[child_col]
        column.soft = True
        column.key = f"soft -> {parent_path}"
        if why:
            column.note = why

    for full, table in tables.items():
        for name, column in table.columns.items():
            marks = ["PK"] if column.pk else []
            if column.key:
                marks.append(column.key)
            column.key = ", ".join(marks)
            if not name:
                warnings.append(f"{full} has an unnamed column.")
        if not table.purpose:
            table.purpose = "(no description yet)"
            warnings.append(f"{full} has no description. Add it to PURPOSE in this script.")
    return Snapshot(revision, settings.postgres_db, extensions, tables, links, warnings)


# --- Writing the file ---------------------------------------------------------------------


def schema_of(name: str) -> str:
    return name.partition(".")[0]


def ordered(names: list[str]) -> list[str]:
    def rank(name: str) -> tuple[int, str]:
        schema = schema_of(name)
        return (SCHEMA_ORDER.index(schema) if schema in SCHEMA_ORDER else len(SCHEMA_ORDER), name)

    return sorted(names, key=rank)


def diagram_name(full: str) -> str:
    return full.replace(".", "_")


def diagram_type(raw: str) -> str:
    return re.sub(r"\s+", "_", re.sub(r"\(.*?\)", "", raw).strip())


MERMAID_THEME = (
    '%%{init: {"theme": "base", "themeVariables": {'
    '"primaryColor": "#E5E8DB", "primaryTextColor": "#26231B", "primaryBorderColor": "#233A56", '
    '"lineColor": "#6F829C", "secondaryColor": "#F4F5EE", "tertiaryColor": "#FFFFFF", '
    '"attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F4F5EE"}}}%%'
)


def mermaid(snapshot: Snapshot) -> list[str]:
    drawn = [name for name in ordered(list(snapshot.tables)) if schema_of(name) not in DIAGRAM_SKIP]
    lines = ["```mermaid", MERMAID_THEME, "erDiagram"]
    for link in snapshot.links:
        if link.child not in drawn or link.parent not in drawn:
            continue
        label = ", ".join(link.child_columns) + (" (soft)" if link.soft else "")
        optional_shape = "|o--o{" if link.optional else "||--o{"
        shape = "|o..o{" if link.soft else optional_shape
        lines.append(
            f'    {diagram_name(link.parent)} {shape} {diagram_name(link.child)} : "{label}"'
        )
    for name in drawn:
        lines.append(f"    {diagram_name(name)} {{")
        for column_name, column in snapshot.tables[name].columns.items():
            parts = [diagram_type(column.type), column_name]
            marks = [mark for mark, on in (("PK", column.pk), ("FK", column.fk)) if on]
            if marks:
                parts.append(", ".join(marks))
            if column.soft:
                parts.append('"soft link"')
            lines.append("        " + " ".join(parts))
        lines.append("    }")
    lines.append("```")
    return lines


def render(snapshot: Snapshot, changes: list[str] | None, earlier: str | None) -> str:
    number = revision_number(snapshot.revision)
    schemas = ordered(list({schema_of(name) for name in snapshot.tables}))
    hard = sum(1 for link in snapshot.links if not link.soft)
    soft = len(snapshot.links) - hard
    extensions = ", ".join(f"`{name}`" for name in snapshot.extensions) or "none"
    out = [
        f"# Database schema {number}",
        "",
        f"Migration `{snapshot.revision}`, the newest one applied to the database "
        f"`{snapshot.database}`.",
        "",
        f"- **Tables:** {len(snapshot.tables)} in {len(schemas)} schemas "
        f"({', '.join(f'`{name}`' for name in schemas)}).",
        f"- **Links:** {hard} foreign keys and {soft} soft links.",
        f"- **Extensions:** {extensions}.",
        "- **Made by** `engine/backend/scripts/schema_map.py` from the live database. "
        "Don't edit it by hand. Run the script after every migration. "
        "`--check` says whether this file is out of date.",
        "",
        f"## Changes since {earlier}" if earlier else "## Changes",
        "",
    ]
    if earlier is None:
        out.append(
            "First saved schema. Earlier migrations are in `backend/core/db/migrations/versions/`, "
            "but their schemas were not saved."
        )
    elif not changes:
        out.append(f"No change since {earlier}.")
    else:
        out += [f"- {change}" for change in changes]
    out += [
        "",
        "## Diagram",
        "",
        *mermaid(snapshot),
        "",
        "How to read it:",
        "",
        "- A **solid line** is a foreign key. The database enforces it. `cascade` means the child "
        "row is deleted with its parent row.",
        "- A **dotted line** is a soft link. A column holds another table's key, but there is no "
        "foreign key, so nothing enforces it.",
        "- The end with three prongs is the *many* side. A circle on an end means *optional*.",
        "- Every column is drawn with its type. `PK` is the primary key and `FK` a foreign key. "
        "LangGraph's own tables are left out. The lists below add the notes, indexes and checks.",
    ]
    last_schema = ""
    for name in ordered(list(snapshot.tables)):
        table = snapshot.tables[name]
        if schema_of(name) != last_schema:
            last_schema = schema_of(name)
            out += ["", f"## Tables in {last_schema}", "", SCHEMA_NOTES.get(last_schema, "")]
        out += ["", f"### {name}", "", table.purpose, ""]
        out += ["| Column | Type | Null | Key | Note |", "|---|---|---|---|---|"]
        for column_name, column in table.columns.items():
            out.append(
                f"| `{column_name}` | {column.type} | {'yes' if column.null else 'no'} "
                f"| {column.key} | {column.note} |"
            )
        if table.indexes:
            out += ["", "**Indexes**", ""]
            out += [f"- `{index}`: {text}" for index, text in table.indexes.items()]
        if table.checks:
            out += ["", "**Checks**", ""]
            out += [f"- `{check}`: {text}" for check, text in table.checks.items()]
    return "\n".join(out) + "\n"


# --- Comparing with a saved file ------------------------------------------------------------


def parse(text: str) -> dict[str, Table]:
    """Reads the tables back from a saved file, so two versions can be compared."""
    tables: dict[str, Table] = {}
    current: Table | None = None
    section = "columns"
    for line in text.splitlines():
        heading = re.fullmatch(r"### (\S+)", line)
        if heading:
            current = tables.setdefault(heading.group(1), Table())
            section = "columns"
        elif line.startswith("## "):
            current = None
        elif current is None:
            continue
        elif line.startswith("**Indexes**"):
            section = "indexes"
        elif line.startswith("**Checks**"):
            section = "checks"
        elif section == "columns" and line.startswith("| `"):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            current.columns[cells[0].strip("`")] = Column(cells[1], cells[2] == "yes", cells[3])
        elif section != "columns" and line.startswith("- `"):
            name, _, text_ = line[3:].partition("`: ")
            (current.indexes if section == "indexes" else current.checks)[name] = text_
    return tables


def changes_between(old: dict[str, Table], new: dict[str, Table]) -> list[str]:
    out: list[str] = []
    for name in ordered(list(new.keys() - old.keys())):
        out.append(f"New table `{name}` ({len(new[name].columns)} columns).")
    for name in ordered(list(old.keys() - new.keys())):
        out.append(f"Removed table `{name}`.")
    for name in ordered(list(old.keys() & new.keys())):
        before, after = old[name], new[name]
        for column in after.columns.keys() - before.columns.keys():
            out.append(f"`{name}`: new column `{column}` ({after.columns[column].type}).")
        for column in before.columns.keys() - after.columns.keys():
            out.append(f"`{name}`: removed column `{column}`.")
        for column in before.columns.keys() & after.columns.keys():
            was, now = before.columns[column], after.columns[column]
            if was.type != now.type:
                out.append(f"`{name}.{column}`: type changed from {was.type} to {now.type}.")
            if was.null != now.null:
                result = "can now be empty" if now.null else "can no longer be empty"
                out.append(f"`{name}.{column}`: {result}.")
            if was.key != now.key:
                out.append(f"`{name}.{column}`: key changed from '{was.key}' to '{now.key}'.")
        for label, was_map, now_map in (
            ("index", before.indexes, after.indexes),
            ("check", before.checks, after.checks),
        ):
            for item in now_map.keys() - was_map.keys():
                out.append(f"`{name}`: new {label} `{item}`.")
            for item in was_map.keys() - now_map.keys():
                out.append(f"`{name}`: removed {label} `{item}`.")
            for item in now_map.keys() & was_map.keys():
                if now_map[item] != was_map[item]:
                    out.append(f"`{name}`: {label} `{item}` changed.")
    return sorted(out)


def revision_number(revision: str) -> str:
    match = re.match(r"\d+", revision)
    return match.group() if match else revision


def number_of(path: Path) -> str:
    return path.stem.removeprefix("SCHEMA-")


def earlier_file(number: str) -> Path | None:
    """The newest saved file for a migration before this one."""
    if not number.isdigit():
        return None
    older = [
        path
        for path in OUT_DIR.glob("SCHEMA-*.md")
        if number_of(path).isdigit() and int(number_of(path)) < int(number)
    ]
    return max(older, key=lambda path: int(number_of(path)), default=None)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="Write nothing. Exit 1 if this migration's saved file is missing or out of date.",
    )
    args = parser.parse_args(argv)

    try:
        snapshot = read_database()
    except psycopg.OperationalError:
        print("Can't reach the database. Is `docker compose up -d` running in engine/?")
        return 1
    number = revision_number(snapshot.revision)
    path = OUT_DIR / f"SCHEMA-{number}.md"
    for warning in snapshot.warnings:
        print(f"Warning: {warning}")

    saved = parse(path.read_text(encoding="utf-8")) if path.exists() else None
    drift = changes_between(saved, snapshot.tables) if saved is not None else None
    if args.check:
        if saved is None:
            print(f"{path.name} is missing. Run the script to make it.")
            return 1
        if drift:
            print(f"{path.name} no longer matches the database:")
            print("\n".join(f"  {line}" for line in drift))
            return 1
        print(f"{path.name} matches the database.")
        return 0

    earlier = earlier_file(number)
    changes = None
    if earlier is not None:
        changes = changes_between(parse(earlier.read_text(encoding="utf-8")), snapshot.tables)
    OUT_DIR.mkdir(exist_ok=True)
    path.write_text(
        render(snapshot, changes, number_of(earlier) if earlier else None),
        encoding="utf-8",
        newline="\n",
    )
    print(f"Saved {path}")
    columns = sum(len(table.columns) for table in snapshot.tables.values())
    print(f"  {len(snapshot.tables)} tables, {columns} columns")
    if drift:
        print(f"Warning: the database no longer matches the old {path.name}. Was a table changed")
        print("outside a migration? The file now shows the database as it is. What differed:")
        print("\n".join(f"  {line}" for line in drift))
    return 0


if __name__ == "__main__":
    sys.exit(main())
