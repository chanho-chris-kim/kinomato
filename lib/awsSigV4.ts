// AWS Signature Version 4, with Web Crypto only (crypto.subtle), so it runs
// the same in the Worker, its scheduled handler and Node. No SDK and no
// Next.js: worker.ts bundles this through lib/email.ts
// (lib/scheduledGraph.test.ts). Checked against AWS's published SigV4 test
// suite (lib/awsSigV4.test.ts).
//
// Signs host, x-amz-date and every header passed in. Path segments are
// percent-encoded once: SES's paths are plain ASCII words, where single and
// double encoding (AWS's rule for non-S3 services) give the same result.

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Text as its own ArrayBuffer (what crypto.subtle's key import takes).
function bytes(text: string): ArrayBuffer {
  const u = encoder.encode(text);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function hmac(key: ArrayBuffer, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(text));
}

// RFC 3986 unreserved characters stay; everything else is %XX, uppercase.
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function signRequest(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now: Date;
}): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  // Header names lowercased, values trimmed with inner whitespace collapsed.
  const toSign: Record<string, string> = { host: url.host, "x-amz-date": amzDate };
  for (const [name, value] of Object.entries(input.headers)) {
    toSign[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  const names = Object.keys(toSign).sort();
  const canonicalHeaders = names.map((n) => `${n}:${toSign[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalPath = url.pathname
    .split("/")
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join("/");
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(input.body),
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(bytes(`AWS4${input.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, input.service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  // The request's own headers as given, plus the two SigV4 adds. Host is
  // set by fetch from the URL.
  return {
    ...input.headers,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
