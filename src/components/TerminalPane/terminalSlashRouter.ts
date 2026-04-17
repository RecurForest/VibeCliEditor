import type {
  AgentProvider,
  AgentSessionProfile,
  ComposerTarget,
  TerminalSessionRecord,
} from "../../types";
import { patchAgentProfile } from "./agentSessionProfiles";

export interface PendingAgentProfiles {
  claude: AgentSessionProfile;
  codex: AgentSessionProfile;
}

interface ResolveComposerInputOptions {
  pendingProfiles: PendingAgentProfiles;
  selectedSession: TerminalSessionRecord | null;
  target: ComposerTarget;
  text: string;
}

export type TerminalComposerResolution =
  | {
      kind: "send_text";
      text: string;
    }
  | {
      kind: "provider_passthrough";
      patchProfile: Partial<AgentSessionProfile>;
      provider: AgentProvider;
      text: string;
    }
  | {
      kind: "update_pending_profile";
      patchProfile: Partial<AgentSessionProfile>;
      provider: AgentProvider;
    }
  | {
      kind: "spawn_successor_session";
      profile: AgentSessionProfile;
    }
  | {
      kind: "reject";
      message: string;
    };

export function resolveTerminalComposerInput({
  pendingProfiles,
  selectedSession,
  target,
  text,
}: ResolveComposerInputOptions): TerminalComposerResolution {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      kind: "reject",
      message: "Enter some text first.",
    };
  }

  if (!trimmed.startsWith("/")) {
    return {
      kind: "send_text",
      text,
    };
  }

  const parsedCommand = parseSlashCommand(trimmed);
  if (!parsedCommand) {
    return {
      kind: "send_text",
      text,
    };
  }

  if (parsedCommand.name === "raw") {
    const rawText = parsedCommand.args.trim();
    return rawText
      ? {
          kind: "send_text",
          text: rawText,
        }
      : {
          kind: "reject",
          message: "Usage: /raw <text>",
        };
  }

  if (parsedCommand.name !== "model") {
    return target.kind === "agentSession"
      ? {
          kind: "send_text",
          text,
        }
      : {
          kind: "reject",
          message: `Unknown command: /${parsedCommand.name}`,
        };
  }

  const model = parsedCommand.args.trim();
  if (!model) {
    return {
      kind: "reject",
      message: "Usage: /model <name>",
    };
  }

  if (target.kind === "shellSession") {
    return {
      kind: "reject",
      message: "/model is only available for AI sessions.",
    };
  }

  const provider = resolveTargetProvider(target, selectedSession);
  if (!provider) {
    return {
      kind: "reject",
      message: "Select Codex or Claude first, then use /model.",
    };
  }

  if (target.kind === "agentSession" && provider === "claude") {
    return {
      kind: "provider_passthrough",
      patchProfile: { model },
      provider,
      text: `/model ${model}`,
    };
  }

  if (target.kind === "agentSession" && provider === "codex") {
    const baseProfile =
      selectedSession?.agent?.requestedProfile ?? pendingProfiles.codex;

    return {
      kind: "spawn_successor_session",
      profile: patchAgentProfile(baseProfile, { model }),
    };
  }

  return {
    kind: "update_pending_profile",
    patchProfile: { model },
    provider,
  };
}

function parseSlashCommand(value: string) {
  const match = value.match(/^\/([a-zA-Z][\w-]*)(?:\s+(.*))?$/);
  if (!match) {
    return null;
  }

  return {
    args: match[2] ?? "",
    name: match[1].toLowerCase(),
  };
}

function resolveTargetProvider(
  target: ComposerTarget,
  selectedSession: TerminalSessionRecord | null,
): AgentProvider | null {
  if (target.kind === "agentSession") {
    return target.provider;
  }

  if (target.kind === "agentLauncher") {
    return target.provider;
  }

  if (selectedSession?.agent?.provider) {
    return selectedSession.agent.provider;
  }

  if (selectedSession?.mode === "codex" || selectedSession?.mode === "claude") {
    return selectedSession.mode;
  }

  return null;
}
