import { z } from "zod";

export const hostRecordSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    sshHost: z.string().min(1),
    username: z.string().nullable(),
    port: z.number().int().positive().nullable(),
    authMode: z.enum(["agent", "privateKey", "password"]),
    privateKeyPath: z.string().nullable(),
    privateKey: z.string().nullable().optional(),
    password: z.string().nullable().optional(),
    proxyUrl: z.string().nullable(),
    hasPassword: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .loose();

export const projectRecordSchema = z
  .object({
    id: z.number().int().positive(),
    hostId: z.number().int().positive(),
    name: z.string().min(1),
    remotePath: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .loose();
