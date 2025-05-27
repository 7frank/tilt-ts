export const sync = (src: string, dest: string) => {
  return { type: "sync" as const, src, dest };
};

export const run = (fileOrPath: string, options: { trigger: string[] }) => {
  return { type: "run" as const, path: fileOrPath, options };
};
