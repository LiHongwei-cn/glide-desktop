export class CredentialSetupRequiredError extends Error {
  constructor() {
    super("需要先完成一次性凭据设置。");
    this.name = "CredentialSetupRequiredError";
  }
}
