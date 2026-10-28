import { Global, Module, type DynamicModule } from '@nestjs/common';

export const RUNTIME = Symbol('RUNTIME');
export interface RuntimeOptions {
  offline: boolean;
  workers: boolean;
  telegram: boolean;
}
@Global()
@Module({})
export class RuntimeModule {
  static configure(options: Partial<RuntimeOptions> = {}): DynamicModule {
    return {
      module: RuntimeModule,
      providers: [
        {
          provide: RUNTIME,
          useValue: { offline: false, workers: true, telegram: true, ...options },
        },
      ],
      exports: [RUNTIME],
    };
  }
}
