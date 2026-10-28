import { parseServerEnvironment } from '@club/shared/server';

export const getEnvironment = () => parseServerEnvironment(process.env);
