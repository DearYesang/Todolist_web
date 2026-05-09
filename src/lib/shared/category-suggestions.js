const CATEGORY_RULES = [
    {
        category: '개발',
        reason: '개발 키워드',
        keywords: [
            'api',
            'bug',
            'codex',
            'css',
            'db',
            'drizzle',
            'github',
            'html',
            'javascript',
            'js',
            'llm',
            'neon',
            'postgres',
            'pr',
            'rust',
            'svelte',
            'typescript',
            'ts',
            'vercel',
            '버그',
            '배포',
            '서버',
            '코드',
            '프론트',
            '백엔드'
        ]
    },
    {
        category: 'CS 공부',
        reason: '컴퓨터공학 키워드',
        keywords: ['acid', 'algorithm', 'database', 'os', '네트워크', '데이터베이스', '알고리즘', '운영체제', '자료구조', '컴퓨터구조']
    },
    {
        category: '리서치',
        reason: '자료 탐색 키워드',
        keywords: ['paper', 'pubmed', '검색', '논문', '리서치', '문헌', '자료', '조사', '학회']
    },
    {
        category: '생활',
        reason: '생활 관리 키워드',
        keywords: ['결제', '구매', '병원', '보험', '사야', '생활', '영수증', '은행', '정리', '청소']
    },
    {
        category: '캘린더',
        reason: '일정 키워드',
        keywords: ['calendar', 'ical', 'ics', '미팅', '약속', '일정', '캘린더']
    }
];

/**
 * @param {{
 *   text?: string;
 *   existingCategories?: string[];
 *   parentCategory?: string;
 *   currentCategory?: string;
 * }} input
 */
export function suggestCategories(input = {}) {
    const text = normalizeSearchText(input.text ?? '');
    const existingCategories = normalizeCategoryList(input.existingCategories ?? []);
    const currentCategory = normalizeCategoryName(input.currentCategory ?? '');
    /** @type {{ name: string; reason: string; score: number }[]} */
    const suggestions = [];

    if (input.parentCategory) {
        addSuggestion(suggestions, input.parentCategory, '상위 작업 카테고리', 100);
    }

    if (text) {
        for (const category of existingCategories) {
            const normalizedCategory = normalizeSearchText(category);
            if (normalizedCategory && text.includes(normalizedCategory)) {
                addSuggestion(suggestions, category, '작업명과 일치', 82);
            }
        }

        for (const rule of CATEGORY_RULES) {
            const matched = rule.keywords.some((keyword) => text.includes(normalizeSearchText(keyword)));
            if (matched) {
                const categoryName = findExistingCategory(rule.category, existingCategories) ?? rule.category;
                addSuggestion(suggestions, categoryName, rule.reason, 70);
            }
        }
    }

    for (const category of existingCategories.slice(0, 5)) {
        addSuggestion(suggestions, category, '기존 카테고리', 20);
    }

    return suggestions
        .filter((suggestion) => suggestion.name !== currentCategory)
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'ko'))
        .slice(0, 5);
}

/** @param {string} value */
export function normalizeCategoryName(value) {
    return value.trim().replace(/\s+/g, ' ');
}

/**
 * @param {string[]} categories
 */
function normalizeCategoryList(categories) {
    const seen = new Set();
    /** @type {string[]} */
    const normalized = [];
    for (const category of categories) {
        const name = normalizeCategoryName(category);
        const key = name.toLocaleLowerCase('ko');
        if (!name || seen.has(key)) continue;
        seen.add(key);
        normalized.push(name);
    }

    return normalized;
}

/**
 * @param {{ name: string; reason: string; score: number }[]} suggestions
 * @param {string} rawName
 * @param {string} reason
 * @param {number} score
 */
function addSuggestion(suggestions, rawName, reason, score) {
    const name = normalizeCategoryName(rawName);
    if (!name) return;

    const existing = suggestions.find((suggestion) => suggestion.name.toLocaleLowerCase('ko') === name.toLocaleLowerCase('ko'));
    if (existing) {
        if (score > existing.score) {
            existing.score = score;
            existing.reason = reason;
        }
        return;
    }

    suggestions.push({ name, reason, score });
}

/**
 * @param {string} category
 * @param {string[]} existingCategories
 */
function findExistingCategory(category, existingCategories) {
    const normalizedCategory = normalizeSearchText(category);
    return existingCategories.find((existing) => normalizeSearchText(existing) === normalizedCategory) ?? null;
}

/** @param {string} text */
function normalizeSearchText(text) {
    return text.toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();
}
