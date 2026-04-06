"use client";
import { useSession } from "next-auth/react";

export function useAdmin() {
  const { data: session } = useSession();
  return {
    isAdmin: !!(session?.user as any)?.isAdmin,
    isLoading: session === undefined,
  };
}
