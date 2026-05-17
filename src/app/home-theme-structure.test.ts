import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

describe("Animal Island frontend theme", () => {
  it("keeps the homepage card layout skeleton unchanged", () => {
    const page = readProjectFile("src/app/page.tsx");

    expect(page).toContain('className="cards-area"');
    expect(page).toContain('className="row row-1"');
    expect(page).toContain('className="row row-2"');
    expect(page.indexOf("<ProfileCard />")).toBeLessThan(page.indexOf("<ProjectsShowcase />"));
    expect(page.indexOf("<ProjectsShowcase />")).toBeLessThan(page.indexOf("<SkillsGrid />"));
    expect(page.indexOf("<SkillsGrid />")).toBeLessThan(page.indexOf("<SloganCard />"));
    expect(page.indexOf("<SloganCard />")).toBeLessThan(page.indexOf("<StatsCard />"));
  });

  it("defines shared island theme tokens and card treatment", () => {
    const css = readProjectFile("src/app/globals.css");

    expect(css).toContain("--island-paper");
    expect(css).toContain("--island-teal");
    expect(css).toContain("--island-on-warm");
    expect(css).toContain("--island-shadow-press");
    expect(css).toContain("box-shadow: var(--island-shadow-press)");
    expect(css).toContain(".island-pressable");
  });

  it("keeps yellow call-to-action text readable in dark mode", () => {
    const profileCard = readProjectFile("src/components/home/ProfileCard.tsx");
    const chatPanel = readProjectFile("src/components/chat/ChatPanel.tsx");
    const contentCard = readProjectFile("src/components/content/ContentCard.tsx");
    const detailPage = readProjectFile("src/app/[category]/[slug]/page.tsx");

    expect(profileCard).toContain('color: "var(--island-on-warm)"');
    expect(chatPanel).toContain("text-[var(--island-on-warm)]");
    expect(contentCard).toContain('color: "var(--island-on-warm)"');
    expect(detailPage).toContain('color: "var(--island-on-warm)"');
  });
});
