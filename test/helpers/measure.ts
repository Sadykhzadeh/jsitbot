/** CPU time of this process so far, in milliseconds. */
function cpuNow(): number {
  const { user, system } = process.cpuUsage();

  return (user + system) / 1000;
}

/**
 * Runs `work` and says how long it took by the clock and in CPU time. A test
 * that wants to know whether something was walked or looped over should look
 * at the CPU time: the clock also counts the time a loaded machine gave to
 * other programs, which says nothing about the code under test.
 */
export async function measure<T>(work: () => Promise<T>): Promise<{ value: T; wallMs: number; cpuMs: number }> {
  const wallStart = performance.now();
  const cpuStart = cpuNow();
  const value = await work();

  return { value, wallMs: performance.now() - wallStart, cpuMs: cpuNow() - cpuStart };
}
