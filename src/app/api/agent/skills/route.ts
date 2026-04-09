import { NextResponse } from "next/server";
import { getAllSkills } from "@/lib/agent/skills";

export async function GET() {
  try {
    const skills = await getAllSkills();
    return NextResponse.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        userInvocable: s.userInvocable,
      })),
    });
  } catch (err) {
    console.error("[GET /api/agent/skills]", err);
    return NextResponse.json({ error: "Failed to load skills" }, { status: 500 });
  }
}
