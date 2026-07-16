/** Hard gates for learning-mode step progression. */

function messageKind(m) {
  return m.kind || (m.role === "system" ? "system" : "speech");
}

/** Messages belonging to the current plan step (between system markers). */
export function currentStepMessages(chat) {
  const stepIndex = Math.max(0, Number(chat.learning?.currentStepIndex) || 0);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let start = 0;
  let end = messages.length;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (messageKind(m) !== "system" && m.role !== "system") continue;
    const match = String(m.text || "").match(/进入第\s*(\d+)\s*步/);
    if (!match) continue;
    const n = Number(match[1]) - 1;
    if (!Number.isFinite(n)) continue;
    if (n === stepIndex) start = i + 1;
    if (n > stepIndex) {
      end = i;
      break;
    }
  }
  return messages.slice(start, end);
}

export function hasPendingQuiz(chat) {
  return (chat.messages || []).some(
    (m) => messageKind(m) === "quiz" && (m.quizStatus || "pending") === "pending"
  );
}

/** Node task = a quiz in the current step that the learner actually answered (skip does not count). */
export function hasCompletedNodeTask(chat) {
  return currentStepMessages(chat).some(
    (m) => messageKind(m) === "quiz" && m.quizStatus === "answered"
  );
}

export function computeAdvanceReady(chat) {
  return hasCompletedNodeTask(chat) && !hasPendingQuiz(chat);
}

/**
 * Validate moving currentStepIndex from prev → next.
 * Linear only: may advance exactly one step when the node task is done; no skip-ahead, no go-back.
 */
export function assertCanAdvance(chat, nextIndex) {
  const prev = Math.max(0, Number(chat.learning?.currentStepIndex) || 0);
  const stepsLen = chat.learning?.plan?.steps?.length || 0;
  if (!stepsLen) return { ok: false, error: "没有可推进的学习计划" };
  if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= stepsLen) {
    return { ok: false, error: "无效的步骤" };
  }
  if (nextIndex === prev) return { ok: true };
  if (nextIndex < prev) {
    return { ok: false, error: "学习进度不可回退，请按顺序完成每一节" };
  }
  if (nextIndex > prev + 1) {
    return { ok: false, error: "请按顺序学习，不能跳节" };
  }
  if (hasPendingQuiz(chat)) {
    return { ok: false, error: "请先完成本节节点任务（测验）" };
  }
  if (!hasCompletedNodeTask(chat)) {
    return { ok: false, error: "请先听完本节并完成最后的节点任务，才能进入下一节" };
  }
  return { ok: true };
}
