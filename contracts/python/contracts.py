"""Reference Pydantic models for the agent control plane.

These are hand-written and idiomatic — nothing here is generated, and nothing
here generates the client. The app's `src/api/schemas.ts` is hand-written too;
`src/api/__tests__/contract.test.ts` over there is what fails the build when the
two stop agreeing.

Every declaration below is a deliberate answer to a question the app asks:

* `Field(min_length=1)` — the app's zod schemas use `.min(1)` on identifiers, so
  an empty-string id is a validation error client-side. Declaring the constraint
  puts it in the spec, where the contract test can see it agrees.
* `AgentStatus(StrEnum)` rather than `str` — the app pins the six statuses. A
  bare `str` here means a seventh status is legal on the wire and fatal in the
  app, and the contract test says so in exactly those terms.
* `datetime` rather than `str` — serialises to ISO-8601, and puts
  `format: date-time` in the spec. The app parses it as a string; it does not
  care which, as long as the spec says which.
* Envelopes (`AgentList`, `MessageEnvelope`) rather than bare arrays — the app
  accepts either, but a top-level array has nowhere to grow a `next_cursor`.

Requires pydantic>=2, fastapi>=0.100.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class AgentStatus(StrEnum):
    """The app renders one pill per value. Adding a member is a breaking change
    for any client that has not shipped support for it — which is the whole
    point of it being an enum in the spec rather than a free string."""

    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"
    STOPPED = "stopped"


class Agent(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    status: AgentStatus
    # `| None = None` serialises as an explicit null, not an absent key. The app
    # accepts both (`z.string().nullish()`), so either is fine here — but if you
    # would rather omit the key entirely, set `response_model_exclude_none=True`
    # on the route and the null disappears from the wire.
    updated_at: datetime | None = None
    description: str | None = None


class AgentList(BaseModel):
    agents: list[Agent]


class MessageRole(StrEnum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


class Message(BaseModel):
    id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    role: MessageRole
    content: str
    # Required, not optional: the app orders the thread by it, so a message
    # without one has no place to be rendered.
    created_at: datetime
    # Set while the reply is still being produced. The app polls at 1.5s for as
    # long as any message carries it, and stops after 60s.
    pending: bool | None = None


class MessageList(BaseModel):
    messages: list[Message]


class MessageEnvelope(BaseModel):
    message: Message


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1)


# ----------------------------------------------------------------- routes
#
# Sketch of the wiring. `response_model` is what puts these shapes in the spec
# *and* filters the outgoing payload, so a field you forget to remove server-side
# cannot leak into a response.
#
#     from fastapi import APIRouter, status
#
#     router = APIRouter(prefix="/v1/agents", tags=["agents"])
#
#     @router.get("", response_model=AgentList)
#     async def list_agents() -> AgentList: ...
#
#     @router.get("/{agent_id}", response_model=Agent)
#     async def get_agent(agent_id: str) -> Agent: ...
#
#     @router.post("/{agent_id}/start", response_model=Agent)
#     async def start_agent(agent_id: str) -> Agent: ...
#
#     @router.get("/{agent_id}/messages", response_model=MessageList)
#     async def list_messages(agent_id: str, after: str | None = None, limit: int | None = None) -> MessageList: ...
#
#     # 202, and it answers with the *user's* message — not the reply. The reply
#     # turns up in a later GET. See docs/control-plane.md in the app repo.
#     @router.post("/{agent_id}/messages", response_model=MessageEnvelope,
#                  status_code=status.HTTP_202_ACCEPTED)
#     async def send_message(agent_id: str, body: SendMessageRequest) -> MessageEnvelope: ...
