import { CacheEntry } from './CacheEntry';

describe('CacheEntry', () => {
    describe('constructor', () => {
        it('should create a cache entry with provided values', () => {
            const hash = 'abc123';
            const svg = '<svg>test</svg>';
            const timestamp = 1000000;
            const accessCount = 5;

            const entry = new CacheEntry(hash, svg, timestamp, accessCount);

            expect(entry.hash).toBe(hash);
            expect(entry.svg).toBe(svg);
            expect(entry.timestamp).toBe(timestamp);
            expect(entry.accessCount).toBe(accessCount);
        });

        it('should use current time as default timestamp', () => {
            const now = 1234567890;
            jest.spyOn(Date, 'now').mockReturnValue(now);

            const entry = new CacheEntry('hash', '<svg></svg>');

            expect(entry.timestamp).toBe(now);

            jest.restoreAllMocks();
        });

        it('should use 0 as default access count', () => {
            const entry = new CacheEntry('hash', '<svg></svg>', 1000);

            expect(entry.accessCount).toBe(0);
        });

        it('should handle empty SVG string', () => {
            const entry = new CacheEntry('hash', '');

            expect(entry.svg).toBe('');
        });
    });

    describe('isExpired', () => {
        it('should return false for entries within maxAge', () => {
            const now = Date.now();
            const entry = new CacheEntry('hash', '<svg></svg>', now);

            const maxAge = 60000; // 1 minute
            expect(entry.isExpired(maxAge)).toBe(false);
        });

        it('should return true for entries older than maxAge', () => {
            const oneHourAgo = Date.now() - 3600000;
            const entry = new CacheEntry('hash', '<svg></svg>', oneHourAgo);

            const maxAge = 1800000; // 30 minutes
            expect(entry.isExpired(maxAge)).toBe(true);
        });

        it('should return false for entries exactly at maxAge boundary', () => {
            const now = Date.now();
            const maxAge = 1000;
            const entry = new CacheEntry('hash', '<svg></svg>', now - maxAge);

            // At exact boundary, should not be expired
            expect(entry.isExpired(maxAge)).toBe(false);
        });

        it('should return true for entries just past maxAge boundary', () => {
            const now = Date.now();
            const maxAge = 1000;
            const entry = new CacheEntry('hash', '<svg></svg>', now - maxAge - 1);

            expect(entry.isExpired(maxAge)).toBe(true);
        });

        it('should handle zero maxAge', () => {
            const entry = new CacheEntry('hash', '<svg></svg>', Date.now() - 1);

            expect(entry.isExpired(0)).toBe(true);
        });

        it('should handle very large maxAge values', () => {
            const entry = new CacheEntry('hash', '<svg></svg>', Date.now());

            const veryLargeMaxAge = Number.MAX_SAFE_INTEGER;
            expect(entry.isExpired(veryLargeMaxAge)).toBe(false);
        });
    });

    describe('touch', () => {
        it('should increment access count by 1', () => {
            const entry = new CacheEntry('hash', '<svg></svg>', Date.now(), 0);

            entry.touch();

            expect(entry.accessCount).toBe(1);
        });

        it('should increment access count multiple times', () => {
            const entry = new CacheEntry('hash', '<svg></svg>', Date.now(), 0);

            entry.touch();
            entry.touch();
            entry.touch();

            expect(entry.accessCount).toBe(3);
        });

        it('should increment from non-zero initial count', () => {
            const entry = new CacheEntry('hash', '<svg></svg>', Date.now(), 10);

            entry.touch();

            expect(entry.accessCount).toBe(11);
        });

        it('should not modify other properties', () => {
            const hash = 'abc123';
            const svg = '<svg>test</svg>';
            const timestamp = 1000000;
            const entry = new CacheEntry(hash, svg, timestamp, 5);

            entry.touch();

            expect(entry.hash).toBe(hash);
            expect(entry.svg).toBe(svg);
            expect(entry.timestamp).toBe(timestamp);
        });
    });

    describe('edge cases', () => {
        it('should handle very long SVG strings', () => {
            const longSvg = '<svg>' + 'x'.repeat(100000) + '</svg>';
            const entry = new CacheEntry('hash', longSvg);

            expect(entry.svg.length).toBe(longSvg.length);
        });

        it('should handle special characters in hash', () => {
            const specialHash = 'abc-123_xyz.456';
            const entry = new CacheEntry(specialHash, '<svg></svg>');

            expect(entry.hash).toBe(specialHash);
        });

        it('should handle negative timestamp values', () => {
            const negativeTimestamp = -1000;
            const entry = new CacheEntry('hash', '<svg></svg>', negativeTimestamp);

            expect(entry.timestamp).toBe(negativeTimestamp);
        });
    });
});
