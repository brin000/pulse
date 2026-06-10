# Own the Agent Orchestrator

Pulse will use Vercel AI SDK's built-in provider support, model calls, and streaming primitives, but the agent loop itself will be controlled by a server-side orchestrator that we write. This keeps tool validation, retry logic, termination conditions, context compression, and timeline events explicit in application code instead of hiding the core agent behavior inside an automatic tool-calling loop.

## Considered Options

- Use the AI SDK automatic tool-calling loop with `maxSteps`.
- Write a small orchestrator that calls the model for local decisions, validates tool input and output with Zod, executes tools, emits Server-Sent Events, compresses context, and decides whether to continue or stop.

## Consequences

The custom orchestrator takes more work than the automatic loop, but it makes Pulse a better demonstration of agent runtime engineering. The project can still use Vercel AI SDK, but the important control surface remains explainable line by line.

Model decisions should be generated with Vercel AI SDK `generateObject` against a Zod `AgentDecision` schema, then validated again by the orchestrator before any tool executes. This gives Pulse two validation boundaries and avoids trusting raw model output.

For model switching, Pulse should use Vercel AI SDK's provider support directly. This keeps the model boundary simple while leaving the custom engineering effort focused on the agent runtime.
