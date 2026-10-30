import { capturePresentation, WorkflowCoordinator } from "./coordinator.ts";
import { getWorkflow, listWorkflows, readWorkflowResource } from "./catalog.ts";
import { id, parseSource, string, type WorkflowJob } from "./state.ts";

export const WORKFLOW_USAGE =
  "usage: dawg workflow list | read <workflow> [resource] | start <workflow> [--brief <text>] [--source <youtube-url|project-file>] [--id <id>] | status [job-id] | cancel <job-id> | resume <job-id> [--json]";
type Output = { write(text: string): unknown };
export type WorkflowCliOptions = Readonly<{
  coordinator?: WorkflowCoordinator;
  signal?: AbortSignal;
  /** An explicit runtime driver. Absent means start creates only a queued job. */
  start?: (
    job: WorkflowJob,
    signal: AbortSignal,
    progress: (line: string) => void,
  ) => Promise<WorkflowJob>;
}>;

export async function runWorkflowCommand(
  argv: readonly string[],
  workspace: string,
  stdout: Output,
  stderr: Output,
  options: WorkflowCliOptions = {},
): Promise<number> {
  const args = argv[0] === "workflow" ? argv.slice(1) : [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(`${WORKFLOW_USAGE}\n`);
    return 0;
  }
  const controller = new AbortController();
  const onInterrupt = () =>
    controller.abort(
      new DOMException("Workflow command interrupted", "AbortError"),
    );
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const json = args.includes("--json");
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const coordinator = options.coordinator ?? new WorkflowCoordinator(workspace);
  const progress = (line: string) => {
    if (!json) stderr.write(`· ${line}\n`);
  };
  const output = (value: unknown) =>
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  try {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--json") continue;
      if (["--brief", "--source", "--id"].includes(arg)) {
        const value = args[++index];
        if (value === undefined || value.startsWith("--") || flags.has(arg))
          throw new Error(`${arg} needs one value`);
        flags.set(arg, value);
      } else if (arg.startsWith("-"))
        throw new Error(`unknown workflow option ${arg.slice(0, 80)}`);
      else positional.push(arg);
    }
    const verb = positional[0];
    if (verb !== "start" && flags.size)
      throw new Error("creation options apply only to start");
    signal.throwIfAborted();
    if (verb === "list" && positional.length === 1) {
      output(listWorkflows());
      return 0;
    }
    if (verb === "read" && positional.length >= 2 && positional.length <= 3) {
      const workflow = getWorkflow(positional[1]!);
      const body = await readWorkflowResource(workflow.id, positional[2]);
      if (json)
        output({
          workflowId: workflow.id,
          resource: positional[2] ?? workflow.instructions,
          text: body,
        });
      else stdout.write(`${body.trimEnd()}\n`);
      return 0;
    }
    if (verb === "start" && positional.length === 2) {
      const workflowId = getWorkflow(positional[1]!).id;
      const locator = flags.get("--source");
      const sources =
        locator === undefined
          ? []
          : [
              parseSource({
                id: "source",
                kind: locator.startsWith("https://") ? "youtube" : "audio",
                locator,
              }),
            ];
      if (workflowId !== "original-house" && !sources.length)
        throw new Error(
          "this workflow needs --source <youtube-url|project-file>",
        );
      const job = await coordinator.create({
        workflowId,
        id: flags.has("--id") ? id(flags.get("--id")) : undefined,
        brief: string(flags.get("--brief") ?? "", "brief", 8_000, true),
        sources,
      });
      progress(`created ${job.id} · ${workflowId} · queued`);
      const result = options.start
        ? await options.start(job, signal, progress)
        : job;
      output(result);
      return 0;
    }
    if (verb === "status" && positional.length <= 2) {
      if (positional[1]) {
        const job = await coordinator.inspect(id(positional[1]));
        output({ ...job, presentationTicket: capturePresentation(job) });
      } else output(await coordinator.list());
      return 0;
    }
    if ((verb === "cancel" || verb === "resume") && positional.length === 2) {
      const job = await coordinator[verb](id(positional[1]));
      progress(`${verb} ${job.id} · ${job.status}`);
      output(job);
      return 0;
    }
    stderr.write(`${WORKFLOW_USAGE}\n`);
    return 2;
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      stderr.write("cancelled\n");
      return 130;
    }
    stderr.write(
      `workflow failed · ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    if (!options.coordinator) coordinator.dispose();
  }
}
