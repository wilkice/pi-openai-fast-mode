import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigLoadError,
  DEFAULT_CONFIG,
  cloneConfig,
  getProjectConfigPath,
  getUserConfigPath,
  isProjectLocalExtension,
  loadConfigFromPath,
  migrateDefaultTargets,
  normalizeConfig,
  normalizeTargets,
  parseConfigJson,
  saveConfigToPath,
  selectConfigPath,
} from "../src/config";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-openai-fast-mode-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("DEFAULT_CONFIG", () => {
  it("starts disabled with exact OpenAI and OpenAI-Codex GPT-5.4/GPT-5.5/GPT-5.6 targets", () => {
    expect(DEFAULT_CONFIG).toEqual({
      enabled: false,
      targets: [
        { provider: "openai", model: "gpt-5.4", serviceTier: "priority" },
        { provider: "openai", model: "gpt-5.5", serviceTier: "priority" },
        { provider: "openai", model: "gpt-5.6", serviceTier: "priority" },
        { provider: "openai", model: "gpt-5.6-sol", serviceTier: "priority" },
        { provider: "openai", model: "gpt-5.6-terra", serviceTier: "priority" },
        { provider: "openai", model: "gpt-5.6-luna", serviceTier: "priority" },
        { provider: "openai-codex", model: "gpt-5.4", serviceTier: "priority" },
        { provider: "openai-codex", model: "gpt-5.5", serviceTier: "priority" },
        { provider: "openai-codex", model: "gpt-5.6", serviceTier: "priority" },
        {
          provider: "openai-codex",
          model: "gpt-5.6-sol",
          serviceTier: "priority",
        },
        {
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          serviceTier: "priority",
        },
        {
          provider: "openai-codex",
          model: "gpt-5.6-luna",
          serviceTier: "priority",
        },
      ],
    });
  });

  it("cloneConfig returns independent copies", () => {
    const copy = cloneConfig();
    copy.enabled = true;
    copy.targets[0]!.model = "changed";

    expect(DEFAULT_CONFIG.enabled).toBe(false);
    expect(DEFAULT_CONFIG.targets[0]!.model).toBe("gpt-5.4");
  });
});

describe("migrateDefaultTargets", () => {
  it("preserves explicit targets and target-specific service tiers", () => {
    const config = {
      enabled: true,
      targets: [
        { provider: "custom-openai", model: "local-model", serviceTier: "flex" },
        { provider: "openai", model: "gpt-5.4", serviceTier: "standard" },
      ],
    };

    expect(migrateDefaultTargets(config)).toEqual(config);
  });

  it("preserves an intentional empty target list", () => {
    expect(migrateDefaultTargets({ enabled: true, targets: [] })).toEqual({
      enabled: true,
      targets: [],
    });
  });

  it("upgrades an exact historical package default to the current defaults", () => {
    expect(
      migrateDefaultTargets({
        enabled: true,
        targets: [
          { provider: "openai", model: "gpt-5.4", serviceTier: "priority" },
          { provider: "openai", model: "gpt-5.5", serviceTier: "priority" },
          {
            provider: "openai-codex",
            model: "gpt-5.4",
            serviceTier: "priority",
          },
          {
            provider: "openai-codex",
            model: "gpt-5.5",
            serviceTier: "priority",
          },
        ],
      }),
    ).toEqual({ enabled: true, targets: DEFAULT_CONFIG.targets });
  });
});

describe("normalizeTargets", () => {
  it("ignores invalid targets and duplicate provider/model pairs while preserving custom providers", () => {
    expect(
      normalizeTargets([
        { provider: "openai", model: "gpt-5.4" },
        { provider: "openai", model: "gpt-5.4", serviceTier: "flex" },
        {
          provider: "openai-codex",
          model: " gpt-5.5 ",
          serviceTier: " priority ",
        },
        { provider: "anthropic", model: "claude" },
        { provider: 1, model: "gpt-5.4" },
        { provider: "openai", model: "" },
        null,
      ]),
    ).toEqual([
      { provider: "openai", model: "gpt-5.4", serviceTier: "priority" },
      { provider: "openai-codex", model: "gpt-5.5", serviceTier: "priority" },
      { provider: "anthropic", model: "claude", serviceTier: "priority" },
    ]);
  });

  it("returns undefined for non-array target values", () => {
    expect(normalizeTargets(undefined)).toBeUndefined();
    expect(normalizeTargets({})).toBeUndefined();
  });
});

describe("normalizeConfig", () => {
  it("falls back to defaults for invalid top-level config", () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig("bad")).toEqual(DEFAULT_CONFIG);
  });

  it("falls back field-by-field while preserving explicit empty targets", () => {
    expect(normalizeConfig({ enabled: true, targets: [] })).toEqual({
      enabled: true,
      targets: [],
    });

    expect(normalizeConfig({ enabled: "yes", targets: "bad" })).toEqual(
      DEFAULT_CONFIG,
    );
  });

  it("uses a provided fallback", () => {
    const fallback = {
      enabled: true,
      targets: [
        { provider: "openai", model: "custom", serviceTier: "priority" },
      ],
    };

    expect(normalizeConfig({}, fallback)).toEqual(fallback);
  });

  it("defaults missing serviceTier to priority", () => {
    expect(
      normalizeConfig({
        enabled: true,
        targets: [{ provider: "openai", model: "gpt-5.4" }],
      }),
    ).toEqual({
      enabled: true,
      targets: [
        { provider: "openai", model: "gpt-5.4", serviceTier: "priority" },
      ],
    });
  });
});

describe("config JSON IO", () => {
  it("parseConfigJson rejects malformed JSON", () => {
    expect(() => parseConfigJson("not-json")).toThrow(SyntaxError);
  });

  it("loadConfigFromPath initializes defaults only when the file is missing", async () => {
    const dir = await makeTempDir();
    const configPath = join(dir, "config.json");

    expect(await loadConfigFromPath(configPath)).toEqual(DEFAULT_CONFIG);
  });

  it("reports malformed JSON with the config path", async () => {
    const dir = await makeTempDir();
    const configPath = join(dir, "config.json");
    await writeFile(configPath, "{", "utf8");

    await expect(loadConfigFromPath(configPath)).rejects.toMatchObject({
      name: "ConfigLoadError",
      kind: "malformed",
      configPath,
    });
    await expect(loadConfigFromPath(configPath)).rejects.toThrow(
      `Fast Mode config at ${configPath} contains malformed JSON`,
    );
  });

  it("distinguishes read failures from missing files", async () => {
    const dir = await makeTempDir();

    await expect(loadConfigFromPath(dir)).rejects.toEqual(
      expect.objectContaining<Partial<ConfigLoadError>>({
        name: "ConfigLoadError",
        kind: "unreadable",
        configPath: dir,
      }),
    );
  });

  it("saveConfigToPath writes normalized config without dropping custom providers", async () => {
    const dir = await makeTempDir();
    const configPath = join(dir, "nested", "config.json");

    await saveConfigToPath(configPath, {
      enabled: true,
      targets: [
        { provider: "openai", model: "gpt-5.4" },
        { provider: "unsupported", model: "x" },
      ],
    });

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      enabled: true,
      targets: [
        { provider: "openai", model: "gpt-5.4", serviceTier: "priority" },
        { provider: "unsupported", model: "x", serviceTier: "priority" },
      ],
    });
  });
});

describe("persistence scope selection", () => {
  it("uses user-level state for a user/global extension when no project config exists", () => {
    const cwd = "/repo";
    const agentDir = "/home/user/.pi/agent";

    expect(
      selectConfigPath({
        cwd,
        agentDir,
        extensionDir: "/home/user/.pi/agent/npm/pi-openai-fast-mode/src",
        exists: () => false,
      }),
    ).toEqual({ scope: "user", path: getUserConfigPath(agentDir) });
  });

  it("ignores an untrusted project config for a global extension", () => {
    const cwd = "/repo";
    const agentDir = "/home/user/.pi/agent";
    const projectPath = getProjectConfigPath(cwd);

    expect(
      selectConfigPath({
        cwd,
        agentDir,
        extensionDir: "/home/user/.pi/agent/npm/pi-openai-fast-mode/src",
        projectTrusted: false,
        exists: (path) => path === projectPath,
      }),
    ).toEqual({ scope: "user", path: getUserConfigPath(agentDir) });
  });

  it("uses an existing trusted project config for a global extension", () => {
    const cwd = "/repo";
    const projectPath = getProjectConfigPath(cwd);

    expect(
      selectConfigPath({
        cwd,
        agentDir: "/home/user/.pi/agent",
        extensionDir: "/home/user/.pi/agent/npm/pi-openai-fast-mode/src",
        projectTrusted: true,
        exists: (path) => path === projectPath,
      }),
    ).toEqual({ scope: "project", path: projectPath });
  });

  it("uses project-level state for project-local packages under cwd/.pi", () => {
    const cwd = "/repo";
    const projectPath = getProjectConfigPath(cwd);

    expect(
      selectConfigPath({
        cwd,
        agentDir: "/home/user/.pi/agent",
        extensionDir: "/repo/.pi/npm/pi-openai-fast-mode/src",
        exists: () => false,
      }),
    ).toEqual({ scope: "project", path: projectPath });
  });

  it("detects project-local extension directories deterministically", () => {
    expect(
      isProjectLocalExtension(
        "/repo/.pi/extensions/pi-openai-fast-mode",
        "/repo",
      ),
    ).toBe(true);
    expect(isProjectLocalExtension("/repo/.pi", "/repo")).toBe(true);
    expect(
      isProjectLocalExtension("/repo/.pi-other/pi-openai-fast-mode", "/repo"),
    ).toBe(false);
    expect(isProjectLocalExtension(undefined, "/repo")).toBe(false);
  });
});
