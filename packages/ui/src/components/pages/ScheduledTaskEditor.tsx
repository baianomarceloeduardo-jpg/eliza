/**
 * ScheduledTaskEditor — owner-facing detail + verb panel for a LifeOps
 * scheduled item (glossary term) surfaced in the unified Automations feed.
 *
 * Scheduled items are owned by the LifeOps runner (the single scheduling
 * spine), NOT the workflow CRUD. So this panel routes its actions to the
 * scheduled-item endpoints — "Run now" fires a manual item through
 * `client.fireScheduledTask` (the runner's strict-fire path); acknowledge,
 * complete, dismiss and snooze go through `client.applyScheduledTask` — rather
 * than the workflow create/update path. It is a thin verb surface, not a full schedule editor:
 * the schedule itself is defined by the seeded definition / chat, consistent
 * with the one-scheduler rule. The code type stays `ScheduledTask` (frozen
 * contract); only the prose/UI say "scheduled item".
 */

import { Bell, CalendarClock, Check, Clock, X } from "lucide-react";
import { useCallback, useState } from "react";
import { client } from "../../api";
import type {
  ScheduledTaskFireResult,
  ScheduledTaskVerbName,
} from "../../api/client-scheduled-tasks";
import type { AutomationItem } from "../../api/client-types-config";
import { useTranslation } from "../../state/TranslationContext.hooks";
import { scheduledTaskScheduleLabel } from "../../utils/scheduled-task-to-automation";
import { Button } from "../ui/button";
import { FieldLabel } from "../ui/field";
import { StatusBadge } from "../ui/status-badge";

export interface ScheduledTaskEditorProps {
  /** The unified item whose `scheduledTask` is the raw record. */
  item: AutomationItem;
  onApplied?: () => void;
  onCancel?: () => void;
}

const SNOOZE_MINUTES = 60;

type EditorAction = ScheduledTaskVerbName | "fire";

export function ScheduledTaskEditor({
  item,
  onApplied,
  onCancel,
}: ScheduledTaskEditorProps) {
  const { t } = useTranslation();
  const task = item.scheduledTask;
  const [busy, setBusy] = useState<EditorAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback(
    async (verb: ScheduledTaskVerbName, payload?: Record<string, unknown>) => {
      if (!task) return;
      setBusy(verb);
      setError(null);
      setNotice(null);
      try {
        await client.applyScheduledTask(task.taskId, verb, payload);
        onApplied?.();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t("scheduledtask.applyError", {
                defaultValue: "Failed to update scheduled item.",
              }),
        );
      } finally {
        setBusy(null);
      }
    },
    [task, onApplied, t],
  );

  const fire = useCallback(async () => {
    if (!task) return;
    setBusy("fire");
    setError(null);
    setNotice(null);
    try {
      const { fire: outcome } = await client.fireScheduledTask(task.taskId);
      const message = describeFireOutcome(outcome, t);
      if (outcome.kind === "fired") {
        setNotice(message);
        onApplied?.();
      } else {
        setError(message);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("scheduledtask.fireError", {
              defaultValue: "Failed to run scheduled item.",
            }),
      );
    } finally {
      setBusy(null);
    }
  }, [task, onApplied, t]);

  if (!task) {
    return (
      <div className="p-6">
        <div className="text-sm text-danger">
          {t("scheduledtask.missing", {
            defaultValue: "This scheduled item is no longer available.",
          })}
        </div>
        <Button variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
          {t("automationsfeed.back", { defaultValue: "Back" })}
        </Button>
      </div>
    );
  }

  const scheduleLabel = scheduledTaskScheduleLabel(task.trigger);
  const isManual = task.trigger.kind === "manual";

  return (
    <div className="device-layout mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarClock className="size-5 shrink-0 text-accent" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-txt">
              {item.title}
            </h1>
            <StatusBadge
              withDot
              tone={item.enabled ? "success" : "muted"}
              label={
                item.enabled
                  ? t("automationsfeed.active", { defaultValue: "Active" })
                  : t("automationsfeed.inactive", { defaultValue: "Inactive" })
              }
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("automationsfeed.back", { defaultValue: "Back" })}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <FieldLabel>
            {t("scheduledtask.schedule", { defaultValue: "Schedule" })}
          </FieldLabel>
          <p className="text-sm text-muted-strong">
            {scheduleLabel ??
              t("scheduledtask.noSchedule", { defaultValue: "No schedule" })}
          </p>
        </div>
        <div className="space-y-1">
          <FieldLabel>
            {t("scheduledtask.prompt", { defaultValue: "What it does" })}
          </FieldLabel>
          <p className="whitespace-pre-wrap text-sm text-txt">
            {task.promptInstructions}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="text-sm text-muted-strong">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Run now fires a manual starter (e.g. the seeded weekly review)
            through the runner; other items are acknowledged once delivered. */}
        <Button
          variant="default"
          size="sm"
          disabled={busy !== null}
          aria-busy={busy === "fire"}
          onClick={() => (isManual ? fire() : apply("acknowledge"))}
        >
          <Bell className="mr-1 size-3.5" aria-hidden />
          {isManual
            ? t("scheduledtask.runNow", { defaultValue: "Run now" })
            : t("scheduledtask.acknowledge", { defaultValue: "Acknowledge" })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => apply("snooze", { minutes: SNOOZE_MINUTES })}
        >
          <Clock className="mr-1 size-3.5" aria-hidden />
          {t("scheduledtask.snooze", { defaultValue: "Snooze 1h" })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => apply("complete")}
        >
          <Check className="mr-1 size-3.5" aria-hidden />
          {t("scheduledtask.complete", { defaultValue: "Complete" })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => apply("dismiss")}
        >
          <X className="mr-1 size-3.5" aria-hidden />
          {t("scheduledtask.dismiss", { defaultValue: "Dismiss" })}
        </Button>
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function describeFireOutcome(
  outcome: ScheduledTaskFireResult,
  t: Translate,
): string {
  switch (outcome.kind) {
    case "fired":
      return t("scheduledtask.fired", { defaultValue: "Ran just now." });
    case "raced":
      return t("scheduledtask.fireRaced", {
        defaultValue: "It was already running. Refresh to see the result.",
      });
    case "skipped":
      return t("scheduledtask.fireSkipped", {
        defaultValue: "Not run: {{reason}}",
        reason: outcome.reason ?? "skipped",
      });
    case "dispatch_deferred":
      return t("scheduledtask.fireDeferred", {
        defaultValue: "Delivery failed; it will retry at {{time}}.",
        time: outcome.nextAttemptAtIso ?? "the next attempt",
      });
    case "dispatch_failed":
      return t("scheduledtask.fireFailed", {
        defaultValue: "Delivery failed: {{error}}",
        error: outcome.error ?? "unknown error",
      });
  }
}
