/** Fonte de tempo injetavel -- deixa os testes deterministas. */
export interface Clock {
  now(): Date;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => new Date(),
};
