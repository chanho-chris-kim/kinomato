import { describe, expect, it } from "vitest";
import { signRequest } from "./awsSigV4";

// AWS's published Signature Version 4 test suite (aws4_testsuite, as shipped
// in botocore's tests/unit/auth/aws4_testsuite): fixed credentials, region,
// service and time, and the exact Authorization header each request must
// produce. If these match, the signer is AWS's algorithm, not ours.

const SUITE = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
  now: new Date("2015-08-30T12:36:00Z"),
};
const credential = "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request";

const sign = (request: { method: string; url: string; headers?: Record<string, string>; body?: string }) =>
  signRequest({ ...SUITE, headers: {}, body: "", ...request });

describe("signRequest against AWS's SigV4 test suite", () => {
  it("get-vanilla", async () => {
    const headers = await sign({ method: "GET", url: "https://example.amazonaws.com/" });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toBe(
      `${credential}, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31`,
    );
  });

  it("post-vanilla", async () => {
    const headers = await sign({ method: "POST", url: "https://example.amazonaws.com/" });
    expect(headers.authorization).toBe(
      `${credential}, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b`,
    );
  });

  it("get-vanilla-query-order-key-case (query sorted by key)", async () => {
    const headers = await sign({ method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1" });
    expect(headers.authorization).toBe(
      `${credential}, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500`,
    );
  });

  it("post-x-www-form-urlencoded (a body, and content-type signed)", async () => {
    const headers = await sign({
      method: "POST",
      url: "https://example.amazonaws.com/",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Param1=value1",
    });
    expect(headers.authorization).toBe(
      `${credential}, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a`,
    );
  });

  it("get-header-value-trim (values trimmed, inner spaces collapsed)", async () => {
    const headers = await sign({
      method: "GET",
      url: "https://example.amazonaws.com/",
      headers: { "My-Header1": " value1", "My-Header2": ' "a   b   c"' },
    });
    expect(headers.authorization).toBe(
      `${credential}, SignedHeaders=host;my-header1;my-header2;x-amz-date, Signature=acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736`,
    );
  });
});

describe("signRequest output", () => {
  it("returns the request's own headers plus x-amz-date and authorization, never the secret", async () => {
    const headers = await sign({
      method: "POST",
      url: "https://email.ca-central-1.amazonaws.com/v2/email/outbound-emails",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(Object.keys(headers).sort()).toEqual(["authorization", "content-type", "x-amz-date"]);
    expect(JSON.stringify(headers)).not.toContain(SUITE.secretAccessKey);
  });
});
