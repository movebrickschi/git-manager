import type { BlameInfo, BlameLine } from "../git-service.js";
import { getGit } from "./_helpers.js";

export const blameService = {
  async getBlame(repoPath: string, filePath: string, commitId?: string): Promise<BlameInfo> {
    const git = getGit(repoPath);
    const args = ["blame", "--porcelain"];
    if (commitId) args.push(commitId);
    args.push("--", filePath);
    const raw = await git.raw(args);

    const lines: BlameLine[] = [];
    const blameLines = raw.split("\n");
    let currentCommit = "";
    let currentAuthor = "";
    let currentEmail = "";
    let currentTime = 0;
    let currentSummary = "";
    let lineNo = 0;

    for (const line of blameLines) {
      const headerMatch = line.match(/^([a-f0-9]{40}) \d+ (\d+)/);
      if (headerMatch) {
        currentCommit = headerMatch[1]!;
        lineNo = parseInt(headerMatch[2]!);
        continue;
      }
      if (line.startsWith("author ")) {
        currentAuthor = line.substring(7);
      } else if (line.startsWith("author-mail ")) {
        currentEmail = line.substring(12).replace(/[<>]/g, "");
      } else if (line.startsWith("author-time ")) {
        currentTime = parseInt(line.substring(12)) * 1000;
      } else if (line.startsWith("summary ")) {
        currentSummary = line.substring(8);
      } else if (line.startsWith("\t")) {
        lines.push({
          lineNo,
          content: line.substring(1),
          commitId: currentCommit,
          shortId: currentCommit.substring(0, 7),
          author: currentAuthor,
          authorEmail: currentEmail,
          time: currentTime,
          summary: currentSummary,
        });
      }
    }

    return { lines };
  },
};
