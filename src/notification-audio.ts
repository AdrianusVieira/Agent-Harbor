type SoundContext = { readonly state: string; resume: () => Promise<void> };

// Only accepts the context already created by an explicit user interaction.
// A browser can still require another gesture; never wait indefinitely for it.
export async function prepareLiveAudio(context: SoundContext | null, timeoutMs = 750) {
  if (!context || context.state === "closed") return false;
  if (context.state === "running") return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      context.resume().then(() => context.state === "running"),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function deliverLiveSound(options: {
  context: SoundContext | null;
  allowed: () => boolean;
  claim: () => Promise<boolean>;
  play: () => boolean;
  timeoutMs?: number;
}): Promise<"played" | "blocked" | "claimed" | "stale"> {
  if (!options.allowed()) return "stale";
  if (!await prepareLiveAudio(options.context, options.timeoutMs)) return "blocked";
  if (!options.allowed()) return "stale";
  // An unarmed or blocked tab must not consume another tab's sound claim.
  if (!await options.claim()) return "claimed";
  if (!options.allowed()) return "stale";
  return options.play() ? "played" : "blocked";
}
