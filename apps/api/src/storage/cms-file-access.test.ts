import { describe, expect, it } from 'vitest';
import { htmlReferencesFile, referencesFile } from './cms-file-access.js';

const asset = { id: '11111111-1111-4111-8111-111111111111' };
const env = { WEB_URL: 'https://club.example', PUBLIC_API_URL: 'https://api.club.example' };
const path = `/api/v1/files/${asset.id}`;

describe('Публичные ссылки CMS на файлы', () => {
  it.each([
    path,
    `${env.WEB_URL}${path}`,
    `${env.PUBLIC_API_URL}${path}`,
    `${env.WEB_URL}${path}/`,
    `${env.WEB_URL}${path}?download=1#photo`,
    `${env.WEB_URL}${path.toUpperCase()}`,
  ])('распознаёт точный локальный fileUrl: %s', (value) => {
    expect(referencesFile(value, asset, env)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    `${env.WEB_URL}${path}-other`,
    `https://other.example${path}`,
    `https://club.example.other.example${path}`,
    `${env.WEB_URL}/other?file=${asset.id}`,
    `javascript:alert('${asset.id}')`,
    `text ${env.WEB_URL}${path}`,
  ])('не принимает постороннее значение за ссылку: %s', (value) => {
    expect(referencesFile(value, asset, env)).toBe(false);
  });

  it.each([
    `<img src="${env.WEB_URL}${path}" alt="Фото">`,
    `<a href="${path}?download=1&amp;size=large#file">Документ</a>`,
    `<p><strong>Описание</strong><img src='${env.PUBLIC_API_URL}${path}'></p>`,
  ])('учитывает src и href в HTML: %s', (html) => {
    expect(htmlReferencesFile(html, asset, env)).toBe(true);
  });

  it.each([
    `<p>${env.WEB_URL}${path}</p>`,
    `<img src="https://other.example${path}">`,
    `<img src="/another-image" alt="${env.WEB_URL}${path}">`,
    `<p data-src="${path}">Описание</p>`,
    `<!-- <img src="${path}"> -->`,
    `<script>const text = '<img src="${path}">';</script>`,
  ])('не раскрывает файл из-за текста, комментария или постороннего атрибута: %s', (html) => {
    expect(htmlReferencesFile(html, asset, env)).toBe(false);
  });
});
