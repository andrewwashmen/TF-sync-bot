import { describe, it, expect } from 'vitest';
import { extractTaskNames } from '../slack/parser.js';

describe('extractTaskNames', () => {
  it('should extract a single task name', () => {
    const message = `*Assessor:* John

*Task Names:*
TF-SH-001 - Blue Suede Shoe Cleaning

*Brand:* Gucci

*Outer Material:* Suede`;

    expect(extractTaskNames(message)).toEqual([
      'TF-SH-001 - Blue Suede Shoe Cleaning',
    ]);
  });

  it('should extract multiple task names separated by dividers', () => {
    const message = `*Assessor:* John

*Task Names:*
TF-SH-001 - Blue Suede Shoe Cleaning

*Brand:* Gucci
*Price:* 250 AED

——————————————————————————

*Task Names:*
TF-BG-002 - Red Leather Handbag Repair

*Brand:* Prada
*Price:* 400 AED

——————————————————————————

*Task Names:*
TF-SH-003 - Black Boot Restoration

*Brand:* Balenciaga
*Price:* 350 AED`;

    expect(extractTaskNames(message)).toEqual([
      'TF-SH-001 - Blue Suede Shoe Cleaning',
      'TF-BG-002 - Red Leather Handbag Repair',
      'TF-SH-003 - Black Boot Restoration',
    ]);
  });

  it('should return empty array when no task names found', () => {
    const message = `Just a regular message with no task names format`;
    expect(extractTaskNames(message)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(extractTaskNames('')).toEqual([]);
  });

  it('should handle task names with special characters', () => {
    const message = `*Task Names:*
TF-SH-001 - Women's Louboutin (Red) - Size 38.5`;

    expect(extractTaskNames(message)).toEqual([
      "TF-SH-001 - Women's Louboutin (Red) - Size 38.5",
    ]);
  });

  it('should skip empty task name lines', () => {
    const message = `*Task Names:*

*Brand:* Gucci`;

    expect(extractTaskNames(message)).toEqual([]);
  });

  it('should handle real Zapier output format with full assessment', () => {
    const message = `Assessment Report:
@tfcx @tf-bc

Please contact the customer to obtain their approval.

*Assessor:* Ahmad

*Task Names:*
ORD-5521 - Gucci Marmont Bag

*Brand:* Gucci

*Outer Material:*
- Calfskin Leather
- Gold Hardware

*Inner Lining:* Suede

*Stain/Damage:*
Color fading on corners, scratch on hardware

*Recommendation:*
- Full color restoration
- Hardware polishing

*Disclaimer:* Results may vary based on leather condition

*Price:* 850 AED
*Turnaround:* 14 days from approval
*Level:* Premium

——————————————————————————

*Task Names:*
ORD-5521 - Gucci Belt Repair

*Brand:* Gucci

*Outer Material:* Leather

*Stain/Damage:*
Buckle loose, leather cracking

*Recommendation:*
- Buckle re-attachment
- Leather conditioning

*Price:* 350 AED
*Turnaround:* 7 days from approval
*Level:* Standard`;

    expect(extractTaskNames(message)).toEqual([
      'ORD-5521 - Gucci Marmont Bag',
      'ORD-5521 - Gucci Belt Repair',
    ]);
  });
});
