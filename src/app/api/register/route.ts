import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";

const userSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = userSchema.parse(body);

    const existingUser = await prisma.user.findUnique({
      where: { email: email }
    });

    if (existingUser) {
      return NextResponse.json({ user: null, message: "User with this email already exists" }, { status: 409 });
    }

    const hashedPassword = await hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword
      }
    });

    const { passwordHash: newUserPasswordHash, ...rest } = newUser;

    return NextResponse.json({ user: rest, message: "User created successfully" }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
        return NextResponse.json({ message: error.issues[0]?.message }, { status: 400 });
    }
    console.error("Registration error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
