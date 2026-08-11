import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { STATUS_KEY, type FastModeConfig, type ModelRef } from "./types";
import { findMatchingTarget } from "./payload";
import { createFastFooterFactory } from "./footer";

export type StatusText = "fast" | undefined;

export type StatusContext = Partial<
  Pick<
    ExtensionContext,
    | "cwd"
    | "getContextUsage"
    | "hasUI"
    | "model"
    | "modelRegistry"
    | "sessionManager"
  >
> & {
  mode?: string;
  ui?: Partial<ExtensionContext["ui"]>;
};

export function getStatusText(
  config: FastModeConfig,
  model: ModelRef | undefined,
): StatusText {
  return config.enabled && findMatchingTarget(model, config.targets)
    ? "fast"
    : undefined;
}

export function canSetTuiStatus(ctx: StatusContext): boolean {
  if (!ctx.hasUI) return false;
  if (ctx.mode !== undefined && ctx.mode !== "tui") return false;
  return (
    typeof ctx.ui?.setFooter === "function" ||
    typeof ctx.ui?.setStatus === "function"
  );
}

function hasFooterContext(ctx: StatusContext): ctx is ExtensionContext {
  return (
    typeof ctx.ui?.setFooter === "function" &&
    typeof ctx.getContextUsage === "function" &&
    ctx.modelRegistry !== undefined &&
    ctx.sessionManager !== undefined
  );
}

function setFastIndicator(
  ctx: StatusContext,
  text: StatusText,
  getThinkingLevel: () => string,
): void {
  if (hasFooterContext(ctx)) {
    // Clear the legacy status first so upgrades do not leave a third footer line.
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setFooter(
      text === undefined
        ? undefined
        : createFastFooterFactory(ctx, getThinkingLevel),
    );
    return;
  }

  // Compatibility fallback for Pi versions without custom footer support.
  ctx.ui?.setStatus?.(STATUS_KEY, text);
}

export function updateFastStatus(
  ctx: StatusContext,
  config: FastModeConfig,
  model: ModelRef | undefined,
  getThinkingLevel: () => string = () => "off",
): void {
  if (!canSetTuiStatus(ctx)) return;
  setFastIndicator(ctx, getStatusText(config, model), getThinkingLevel);
}

export function clearFastStatus(ctx: StatusContext): void {
  if (!canSetTuiStatus(ctx)) return;
  setFastIndicator(ctx, undefined, () => "off");
}
