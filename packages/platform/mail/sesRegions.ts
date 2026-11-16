/**
 * The AWS regions with an Amazon SES v2 endpoint (`email.<region>.amazonaws.com`) that the mail
 * settings accept (plan p03 → HTTPS adapters). A fixed list: the region goes into a URL, so nothing
 * else may. Add a region here when AWS opens SES in it.
 */
export const SES_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-south-1',
  'eu-north-1',
  'ap-south-1',
  'ap-south-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'af-south-1',
  'me-south-1',
  'me-central-1',
  'il-central-1',
] as const;

export type SesRegion = (typeof SES_REGIONS)[number];

export function isSesRegion(value: unknown): value is SesRegion {
  return typeof value === 'string' && (SES_REGIONS as readonly string[]).includes(value);
}
