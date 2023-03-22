import * as core from '@actions/core';
import type { Credentials } from '@aws-sdk/client-sts';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { CredentialsClient } from './CredentialsClient';

const MAX_TAG_VALUE_LENGTH = 256;
const SANITIZATION_CHARACTER = '_';

// Configure the AWS CLI and AWS SDKs using environment variables and set them as secrets.
// Setting the credentials as secrets masks them in Github Actions logs
export function exportCredentials(creds?: Partial<Credentials>) {
  if (creds?.AccessKeyId) {
    core.setSecret(creds.AccessKeyId);
    core.exportVariable('AWS_ACCESS_KEY_ID', creds.AccessKeyId);
  }

  if (creds?.SecretAccessKey) {
    core.setSecret(creds.SecretAccessKey);
    core.exportVariable('AWS_SECRET_ACCESS_KEY', creds.SecretAccessKey);
  }

  if (creds?.SessionToken) {
    core.setSecret(creds.SessionToken);
    core.exportVariable('AWS_SESSION_TOKEN', creds.SessionToken);
  } else if (process.env['AWS_SESSION_TOKEN']) {
    // clear session token from previous credentials action
    core.exportVariable('AWS_SESSION_TOKEN', '');
  }
}

export function exportRegion(region: string) {
  core.exportVariable('AWS_DEFAULT_REGION', region);
  core.exportVariable('AWS_REGION', region);
}

// Obtains account ID from STS Client and sets it as output
export async function exportAccountId(credentialsClient: CredentialsClient, maskAccountId?: string) {
  const client = credentialsClient.getStsClient();
  const identity = await client.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;
  if (!accountId) {
    throw new Error('Could not get Account ID from STS. Did you set credentials?');
  }
  if (maskAccountId) {
    core.setSecret(accountId);
  }
  core.setOutput('aws-account-id', accountId);
  return accountId;
}

// Tags have a more restrictive set of acceptable characters than GitHub environment variables can.
// This replaces anything not conforming to the tag restrictions by inverting the regular expression.
// See the AWS documentation for constraint specifics https://docs.aws.amazon.com/STS/latest/APIReference/API_Tag.html.
export function sanitizeGitHubVariables(name: string) {
  const nameWithoutSpecialCharacters = name.replace(/[^\p{L}\p{Z}\p{N}_.:/=+\-@]/gu, SANITIZATION_CHARACTER);
  const nameTruncated = nameWithoutSpecialCharacters.slice(0, MAX_TAG_VALUE_LENGTH);
  return nameTruncated;
}

export async function defaultSleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
let sleep = defaultSleep;

export function withsleep(s: typeof sleep) {
  sleep = s;
}

export function reset() {
  sleep = defaultSleep;
}

// Retries the promise with exponential backoff if the error isRetryable up to maxRetries time.
export async function retryAndBackoff<T>(
  fn: () => Promise<T>,
  isRetryable: boolean,
  retries = 0,
  maxRetries = 12,
  base = 50
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable) {
      throw err;
    }
    // It's retryable, so sleep and retry.
    await sleep(Math.random() * (Math.pow(2, retries) * base));
    retries += 1;
    if (retries === maxRetries) {
      throw err;
    }
    return await retryAndBackoff(fn, isRetryable, retries, maxRetries, base);
  }
}

/* c8 ignore start */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isDefined<T>(i: T | undefined | null): i is T {
  return i !== undefined && i !== null;
}
/* c8 ignore stop */