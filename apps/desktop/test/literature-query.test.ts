import { describe, expect, it } from 'vitest';

import {
  literatureQueryNeedsPlanning,
  literatureQueryTerms,
  literatureTermMatchCount,
  requiredLiteratureTermMatches,
} from '../src/shared/literature-query';

describe('literature query terms', () => {
  it('keeps topic words and drops request words, stop words and very short tokens', () => {
    expect(literatureQueryTerms('A survey of TabPFN for many-class classification')).toEqual([
      'tabpfn',
      'many',
      'class',
      'classification',
    ]);
    expect(literatureQueryTerms('3D object detection with AI')).toEqual([
      '3d',
      'object',
      'detection',
    ]);
  });

  it('returns no terms when the text only names the act of searching', () => {
    expect(literatureQueryTerms('논문 검색')).toEqual([]);
    expect(literatureQueryTerms('find papers')).toEqual([]);
    expect(literatureQueryTerms('관련 논문 찾아줘')).toEqual([]);
  });

  it('keeps Korean topic words but not Korean request words', () => {
    expect(literatureQueryTerms('라벨 임베딩 확장 관련 논문 찾아줘')).toEqual([
      '라벨',
      '임베딩',
      '확장',
    ]);
  });

  it('deduplicates and bounds the number of terms', () => {
    expect(literatureQueryTerms('lasso Lasso LASSO graphical')).toEqual(['lasso', 'graphical']);
    const many = Array.from({ length: 60 }, (_, index) => `topic${index}`).join(' ');
    expect(literatureQueryTerms(many)).toHaveLength(24);
  });
});

describe('literature term matching', () => {
  const terms = literatureQueryTerms('TabPFN class expansion label embedding');

  it('counts distinct query terms that a paper mentions, tolerating inflection', () => {
    expect(
      literatureTermMatchCount(
        'TabPFN: a transformer for small tabular classification problems. Label embeddings.',
        terms,
      ),
    ).toBe(4);
    expect(
      literatureTermMatchCount('Class struggle in nineteenth century labour markets', terms),
    ).toBe(1);
    expect(literatureTermMatchCount('Deep residual learning for image recognition', terms)).toBe(0);
  });

  it('does not let a very short word match a longer one', () => {
    expect(literatureTermMatchCount('The tab key and the lab', ['tabpfn', 'label'])).toBe(0);
  });

  it('never matches a Korean sentence against an English paper', () => {
    expect(
      literatureTermMatchCount(
        'Sparse inverse covariance estimation with the graphical lasso',
        literatureQueryTerms('고차원 공분산 추정 관련 논문 찾아줘'),
      ),
    ).toBe(0);
  });

  it('asks for two matching terms once the query is specific enough', () => {
    expect(requiredLiteratureTermMatches(0)).toBe(0);
    expect(requiredLiteratureTermMatches(1)).toBe(1);
    expect(requiredLiteratureTermMatches(3)).toBe(1);
    expect(requiredLiteratureTermMatches(4)).toBe(2);
    expect(requiredLiteratureTermMatches(12)).toBe(2);
  });
});

describe('literature query planning trigger', () => {
  it('plans for non-Latin text, questions, requests and long sentences', () => {
    for (const text of [
      'TabPFN 클래스 확장과 관련된 논문 찾아줘',
      '표 형식 데이터 foundation model',
      'What are the limits of in-context learning for tabular data?',
      'find papers about label embedding expansion',
      'Please search for recent work on graphical lasso',
      'methods that extend a pretrained tabular classifier to many more classes than it saw',
    ]) {
      expect(literatureQueryNeedsPlanning(text), text).toBe(true);
    }
  });

  it('searches plain keyword queries directly', () => {
    for (const text of [
      'TabPFN',
      'graphical lasso covariance estimation',
      'retrieval augmented generation evaluation',
      'Ledoit-Wolf shrinkage',
      'many-class classification tabular foundation model',
    ]) {
      expect(literatureQueryNeedsPlanning(text), text).toBe(false);
    }
  });
});
