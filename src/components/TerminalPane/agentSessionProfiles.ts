import type {
  AgentProvider,
  AgentSessionProfile,
  RuntimeModelSwitchStrategy,
} from "../../types";

export interface AgentTerminalProcess {
  args: string[];
  command: string;
}

export function createDefaultAgentProfile(provider: AgentProvider): AgentSessionProfile {
  return {
    approvalPolicy: null,
    effort: null,
    model: null,
    profile: null,
    provider,
    sandboxMode: null,
  };
}

export function cloneAgentProfile(profile: AgentSessionProfile): AgentSessionProfile {
  return {
    approvalPolicy: profile.approvalPolicy ?? null,
    effort: profile.effort ?? null,
    model: profile.model ?? null,
    profile: profile.profile ?? null,
    provider: profile.provider,
    sandboxMode: profile.sandboxMode ?? null,
  };
}

export function patchAgentProfile(
  profile: AgentSessionProfile,
  patch: Partial<AgentSessionProfile>,
): AgentSessionProfile {
  return {
    ...cloneAgentProfile(profile),
    ...patch,
    provider: patch.provider ?? profile.provider,
  };
}

export function getRuntimeModelSwitchStrategy(
  provider: AgentProvider,
): RuntimeModelSwitchStrategy {
  return provider === "claude" ? "provider-passthrough" : "successor-session";
}

export function getAgentProviderLabel(provider: AgentProvider) {
  return provider === "codex" ? "Codex" : "Claude";
}

export function buildAgentTerminalProcess(profile: AgentSessionProfile): AgentTerminalProcess {
  const command = profile.provider === "codex" ? "codex" : "claude";
  const args: string[] = [];

  if (profile.provider === "codex") {
    args.push("--yolo");
    args.push("--no-alt-screen");

    if (profile.model?.trim()) {
      args.push("--model", profile.model.trim());
    }
    if (profile.profile?.trim()) {
      args.push("--profile", profile.profile.trim());
    }
    if (profile.sandboxMode?.trim()) {
      args.push("--sandbox", profile.sandboxMode.trim());
    }
    if (profile.approvalPolicy?.trim()) {
      args.push("--ask-for-approval", profile.approvalPolicy.trim());
    }
  } else {
    if (profile.model?.trim()) {
      args.push("--model", profile.model.trim());
    }
    if (profile.effort?.trim()) {
      args.push("--effort", profile.effort.trim());
    }
  }

  return {
    args,
    command,
  };
}
