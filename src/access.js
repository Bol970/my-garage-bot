export function garageAccess(env, userId) {
  const owner = env.OWNER_TELEGRAM_ID;
  const viewer = String(userId);
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[1-9]\d*$/.test(owner ?? "") ||
      ![owner, env.TEACHER_TELEGRAM_ID].includes(viewer)) return null;
  return { owner, viewer };
}
