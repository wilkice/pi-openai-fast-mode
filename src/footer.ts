import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type FastFooterFactory = Parameters<ExtensionContext["ui"]["setFooter"]>[0];

type FooterContext = Pick<
  ExtensionContext,
  "cwd" | "model" | "modelRegistry" | "sessionManager" | "getContextUsage"
>;

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
  if (count < 1_000) return count.toString();
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatCwdForFooter(
  cwd: string,
  home: string | undefined,
): string {
  if (!home) return cwd;

  const resolvedCwd = resolve(cwd);
  const relativeToHome = relative(resolve(home), resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

export function appendFastIndicator(rightSide: string): string {
  return `${rightSide} • fast`;
}

/**
 * Reproduces Pi's built-in footer while placing Fast Mode in its model/thinking
 * group. Pi's status API renders extension statuses on a separate line, so a
 * custom footer is required for an inline indicator.
 */
export function createFastFooterFactory(
  ctx: FooterContext,
  getThinkingLevel: () => string,
): FastFooterFactory {
  return (tui, theme, footerData) => {
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsubscribe,
      invalidate(): void {},
      render(width: number): string[] {
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheWrite = 0;
        let totalCost = 0;
        let latestCacheHitRate: number | undefined;

        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type !== "message" || entry.message.role !== "assistant") {
            continue;
          }

          const usage = entry.message.usage;
          totalInput += usage.input;
          totalOutput += usage.output;
          totalCacheRead += usage.cacheRead;
          totalCacheWrite += usage.cacheWrite;
          totalCost += usage.cost.total;

          const latestPromptTokens =
            usage.input + usage.cacheRead + usage.cacheWrite;
          latestCacheHitRate =
            latestPromptTokens > 0
              ? (usage.cacheRead / latestPromptTokens) * 100
              : undefined;
        }

        const usage = ctx.getContextUsage();
        const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
        const contextPercentValue = usage?.percent ?? 0;
        const contextPercent =
          usage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

        let pwd = formatCwdForFooter(
          ctx.sessionManager.getCwd(),
          process.env.HOME || process.env.USERPROFILE,
        );
        const branch = footerData.getGitBranch();
        if (branch) pwd = `${pwd} (${branch})`;
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) pwd = `${pwd} • ${sessionName}`;

        const statsParts: string[] = [];
        if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
        if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
        if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
        if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
        if (
          (totalCacheRead > 0 || totalCacheWrite > 0) &&
          latestCacheHitRate !== undefined
        ) {
          statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
        }

        const usingSubscription = ctx.model
          ? ctx.modelRegistry.isUsingOAuth(ctx.model)
          : false;
        if (totalCost || usingSubscription) {
          statsParts.push(
            `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
          );
        }

        const contextDisplay =
          contextPercent === "?"
            ? `?/${formatTokens(contextWindow)}`
            : `${contextPercent}%/${formatTokens(contextWindow)}`;
        statsParts.push(
          contextPercentValue > 90
            ? theme.fg("error", contextDisplay)
            : contextPercentValue > 70
              ? theme.fg("warning", contextDisplay)
              : contextDisplay,
        );

        let statsLeft = statsParts.join(" ");
        let statsLeftWidth = visibleWidth(statsLeft);
        if (statsLeftWidth > width) {
          statsLeft = truncateToWidth(statsLeft, width, "...");
          statsLeftWidth = visibleWidth(statsLeft);
        }

        const modelName = ctx.model?.id || "no-model";
        let modelAndReasoning = modelName;
        if (ctx.model?.reasoning) {
          const level = getThinkingLevel() || "off";
          modelAndReasoning =
            level === "off"
              ? `${modelName} • thinking off`
              : `${modelName} • ${level}`;
        }
        modelAndReasoning = appendFastIndicator(modelAndReasoning);

        let rightSide = modelAndReasoning;
        if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
          const withProvider = `(${ctx.model.provider}) ${modelAndReasoning}`;
          if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
            rightSide = withProvider;
          }
        }

        const availableForRight = width - statsLeftWidth - 2;
        let statsLine = statsLeft;
        if (statsLeftWidth + 2 + visibleWidth(rightSide) <= width) {
          statsLine =
            statsLeft +
            " ".repeat(width - statsLeftWidth - visibleWidth(rightSide)) +
            rightSide;
        } else if (availableForRight > 0) {
          const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
          statsLine =
            statsLeft +
            " ".repeat(
              Math.max(
                0,
                width - statsLeftWidth - visibleWidth(truncatedRight),
              ),
            ) +
            truncatedRight;
        }

        const remainder = statsLine.slice(statsLeft.length);
        const lines = [
          truncateToWidth(
            theme.fg("dim", pwd),
            width,
            theme.fg("dim", "..."),
          ),
          theme.fg("dim", statsLeft) + theme.fg("dim", remainder),
        ];

        const otherStatuses = Array.from(
          footerData.getExtensionStatuses().entries(),
        )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatusText(text));
        if (otherStatuses.length > 0) {
          lines.push(
            truncateToWidth(
              otherStatuses.join(" "),
              width,
              theme.fg("dim", "..."),
            ),
          );
        }

        return lines;
      },
    };
  };
}
