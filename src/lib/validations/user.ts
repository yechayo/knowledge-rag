import { z } from "zod";

export const UserSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').optional(),
});
