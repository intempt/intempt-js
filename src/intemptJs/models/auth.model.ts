import { AuthConfig } from '../types/intemptJs.types.ts';

export class AuthRequest {
  auth: AuthConfig = undefined!;
  constructor({ username, password }: AuthConfig) {
    this.auth = {
      username,
      password,
    };
  }
}
