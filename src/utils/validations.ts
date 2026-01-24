import { z } from 'zod';

export const checkAvailabilitySchema = z.object({
    email: z.string().email('Invalid email format').optional(),
    pseudo: z.string()
        .min(3, 'Pseudo must be at least 3 characters')
        .max(20, 'Pseudo must be max 20 characters')
        .regex(/^[a-zA-Z0-9_-]+$/, 'Pseudo can only contain letter, number, _ and -')
        .optional()
}).refine(
    (data) => data.email || data.pseudo,
    { message: 'Either email or pseudo must be provided' }
);
