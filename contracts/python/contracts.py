"""Reference Pydantic models for the `agency` HTTP API.

**The server is authoritative, not this file.** The models here mirror
`contracts/openapi.json` — the spec the running server actually serves, pinned by
`npm run contract:pull`. They exist so the wire contract can be read in one sitting
on the Python side, and so the *reasons* behind the declarations survive; they are
not imported by anything and nothing is generated from them.

Re-synced 2026-08-21. The previous version of this file described `Agent`,
`AgentList`, `Message` and `MessageList` — a per-agent message thread and agent
lifecycle commands that no server has ever served. The app was written against
those shapes and the contract test is what caught it. If you edit this file and
the server, run `python export_openapi.py` and commit the spec: the app's
`contract.test.ts` is what turns a wire-format change into a build failure
instead of a runtime one.

Every declaration below is a deliberate answer to a question the app asks:

* Enums (`AgentStatus`, availability, session status, tool-event phase) rather
  than `str` — the app pins the values. A bare `str` means a seventh status is
  legal on the wire and fatal in the app, and the contract test says so in
  exactly those terms.
* `Field(min_length=1)` where, and only where, the app may rely on it. Note that
  `AgentInfo.name` deliberately has none: the app's zod schema does not demand
  one either, and a client stricter than its contract refuses legal responses.
* `datetime` rather than `str` — serialises to ISO-8601 and puts
  `format: date-time` in the spec. The app parses it as a string; it does not
  care which, as long as the spec says which.
* Envelopes (`AgentsResponse`, `SessionsResponse`) rather than bare arrays — the
  app accepts either, but a top-level array has nowhere to grow a `next_cursor`.
* `Problem.detail` is required. The app renders it verbatim in place of its own
  generic copy, so it is part of the contract rather than a debugging nicety.

`(str, Enum)` rather than `enum.StrEnum`: StrEnum is 3.11+, and the service
declares `requires-python = ">=3.10"`. On 3.10 the import alone raises and takes
the whole API down with it. The two serialise identically here.

Requires pydantic>=2, fastapi>=0.100.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

# ----------------------------------------------------------------- health


class Health(BaseModel):
    """Liveness. Cheap and dependency-free by design — a liveness probe that
    checks dependencies restarts the process when a dependency blips, which is
    backwards."""

    status: Literal["ok"] = "ok"
    version: str


class Readiness(BaseModel):
    """Readiness. Checks the things a run actually needs before accepting traffic.

    `capacity` is what the app puts on the control plane: free run and session
    slots are the difference between "the API is up" and "the API will take my
    prompt right now"."""

    status: Literal["ready", "degraded"]
    checks: dict[str, str]
    capacity: dict[str, int]


# ----------------------------------------------------------------- agents


class AgentStatus(str, Enum):
    """The app renders one pill per value. Adding a member is a breaking change
    for any client that has not shipped support for it — which is the whole
    point of it being an enum in the spec rather than a free string.

    Not every member is reachable: the hook stream yields `idle`, `running` and
    `error`. `starting`, `paused` and `stopped` are reserved, because removing a
    member is as breaking as adding one."""

    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"
    STOPPED = "stopped"


class Availability(str, Enum):
    ALWAYS = "always"
    TEAM = "team"


class AgentInfo(BaseModel):
    """One subagent the server can invoke.

    Deliberately not the whole agent definition: `prompt` is an implementation
    detail, and publishing it would make every prompt tweak a breaking API
    change. What is here is what a caller needs to choose an agent and predict
    what it can do — which is also all the app renders.

    There is no start/stop/pause endpoint for one of these, and that is not an
    omission: the SDK exposes `interrupt()` on the main session, not on
    individual workers."""

    id: str = Field(min_length=1)
    # No min_length: an agent name is server-chosen and the app does not require
    # one. Adding a constraint here without adding it in schemas.ts is harmless;
    # the reverse is a client that refuses a legal response.
    name: str
    status: AgentStatus
    description: str
    availability: Availability
    # Never null: the time the agent entered its current status, or the time this
    # server started observing. Use `invocations == 0` to tell "never ran" from
    # "ran and finished" — the timestamp cannot distinguish them.
    updated_at: datetime
    model: str | None = None
    tools: list[str] | None = None
    max_turns: int | None = None
    invocations: int = 0


class AgentsResponse(BaseModel):
    agents: list[AgentInfo]
    count: int


# ------------------------------------------------------------------- runs


class Profile(str, Enum):
    DEV = "dev"
    SANDBOXED = "sandboxed"
    EVAL = "eval"


class RunRequest(BaseModel):
    model_config = {"extra": "forbid"}

    prompt: str = Field(min_length=1, max_length=20_000)
    profile: Profile | None = None
    team: bool = False


class ToolEvent(BaseModel):
    tool: str
    phase: Literal["pre", "post", "blocked", "failed"]
    at: str
    detail: dict[str, Any] = Field(default_factory=dict)


class RunResponse(BaseModel):
    """Result of a completed run.

    `is_error=True` is still a 200: the request succeeded, the agent did not.
    Transport failures get a 5xx problem document instead. The app reads the flag
    and says so on the bubble, because nothing in the status line will."""

    run_id: str
    profile: str
    model: str
    is_error: bool
    output: str | None
    num_turns: int
    duration_ms: int
    total_cost_usd: float
    usage: dict[str, Any]
    tools_used: list[str]
    delegated_to: list[str]
    tool_events: list[ToolEvent]
    summary: str


# --------------------------------------------------------------- sessions


class SessionCreateRequest(BaseModel):
    """Every field optional: the server's own profile and a solo agent are the
    defaults, same as a run. Both are fixed for the session's life."""

    model_config = {"extra": "forbid"}

    profile: Profile | None = None
    team: bool = False


class MessageRequest(BaseModel):
    """Only a prompt. `profile` and `team` are absent on purpose and, because of
    `extra="forbid"`, sending either is a 422 rather than a silent no-op — they
    were baked into the options this session connected with. Open a new session
    instead."""

    model_config = {"extra": "forbid"}

    prompt: str = Field(min_length=1, max_length=20_000)


class SessionInfo(BaseModel):
    """One open session.

    Deliberately not the conversation: the transcript is not stored here (each
    turn is persisted as its own run record), and the SDK client behind it is not
    something a caller can be handed a view of. The app keeps its own transcript
    for exactly this reason."""

    id: str
    profile: str
    team: bool
    status: Literal["idle", "busy"]
    turns: int
    created_at: datetime
    last_active_at: datetime
    expires_at: datetime | None = None


class SessionsResponse(BaseModel):
    sessions: list[SessionInfo]
    count: int


class MessageResponse(BaseModel):
    """Result of one turn.

    The turn's result is nested as `run` rather than flattened alongside
    `session_id`, so it is the *same* object `POST /v1/runs` returns — the app
    renders a turn and a one-shot run through one code path, and a field added to
    `RunResponse` cannot collide with a session field."""

    session_id: str
    turn: int
    run: RunResponse


# ------------------------------------------------------------- problems


class Problem(BaseModel):
    """RFC 9457. `detail` is what the app shows the user in place of its own
    generic copy, so write it for a human: which session, which limit, what to do
    next."""

    type: str
    title: str
    status: int
    detail: str
    instance: str | None = None
    request_id: str | None = None


# ----------------------------------------------------------------- routes
#
# Sketch of the wiring. `response_model` is what puts these shapes in the spec
# *and* filters the outgoing payload, so a field you forget to remove server-side
# cannot leak into a response.
#
#     from fastapi import APIRouter, status
#
#     agents = APIRouter(prefix="/v1/agents", tags=["agents"])
#
#     @agents.get("", response_model=AgentsResponse)
#     async def list_agents() -> AgentsResponse: ...
#
#     # 404, not an empty 200: an unknown id is a caller error, and a body for it
#     # would let that error survive as far as POST /v1/runs.
#     @agents.get("/{agent_id}", response_model=AgentInfo)
#     async def get_agent(agent_id: str = Path(min_length=1, max_length=64)) -> AgentInfo: ...
#
#     sessions = APIRouter(prefix="/v1/sessions", tags=["sessions"])
#
#     # 201: this creates a server-side resource the caller must now close.
#     @sessions.post("", response_model=SessionInfo, status_code=status.HTTP_201_CREATED)
#     async def open_session(body: SessionCreateRequest) -> SessionInfo: ...
#
#     # 409 while a turn is in flight, rather than tearing the client out mid-turn.
#     @sessions.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
#     async def close_session(session_id: str) -> None: ...
#
#     # One turn. Takes a RunSlots slot as well as the session lock, so N sessions
#     # are not N ways around the run cap.
#     @sessions.post("/{session_id}/messages", response_model=MessageResponse)
#     async def send_message(session_id: str, body: MessageRequest) -> MessageResponse: ...
