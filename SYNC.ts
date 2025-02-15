/*

 load previous "state"
 run all commands and update state
 diff state
 run actual commands from the diff
 */
export const sync = (src: string, dest: string) => {
  return { type: "sync", src, dest };
};
export type SYNC = ReturnType<typeof sync>;
export const run = (fileOrPath: string, options: { trigger: string[]; }) => {
  return { type: "run", path: fileOrPath, options };
};
export type RUN = ReturnType<typeof run>;
