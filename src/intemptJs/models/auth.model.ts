import { AuthConfig } from '../types/intemptJs.types.ts';

export class AuthRequest{
  auth:AuthConfig
  constructor({username, password}:AuthConfig) {
    this.auth = {
      username, password
    }
  }
}
