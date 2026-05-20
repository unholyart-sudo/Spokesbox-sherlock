'use strict';
/**
 * Shared email design tokens.
 * Each project imports BASE_TOKENS and spreads its own overrides.
 * Never hard-code colors/fonts/widths inside template builders.
 */

const BASE_TOKENS = {
  maxWidth:       '600px',
  bgPage:         '#07090f',
  bgCard:         '#0d1121',
  bgHeader:       '#000000',
  colorGold:      '#c9a84c',
  colorGoldLight: '#e2c46a',
  colorWhite:     '#f2ece0',
  colorOffWhite:  '#d4cfc4',
  colorMuted:     '#6b7a96',
  colorBorder:    'rgba(201,168,76,0.18)',
  colorLink:      '#c9a84c',
  fontSerif:      "Georgia, 'Times New Roman', serif",
  fontSans:       "'Helvetica Neue', Arial, sans-serif",
  fontSizeBody:   '15px',
  fontSizeSmall:  '12px',
  lineHeight:     '1.75',
  borderRadius:   '12px',
};

const TORAHTXT_TOKENS = { ...BASE_TOKENS, bgPage: '#1a1c2e' };

const SKYTUNED_TOKENS  = { ...BASE_TOKENS };

const SPOKESBOX_TOKENS = {
  ...BASE_TOKENS,
  bgPage:      '#f0f4f8',
  bgCard:      '#ffffff',
  bgHeader:    '#1a2744',
  colorGold:   '#667eea',
  colorWhite:  '#1a2744',
  colorOffWhite:'#2d3748',
  colorMuted:  '#718096',
  colorBorder: '#e2e8f0',
  colorLink:   '#667eea',
};

const TODO_TOKENS = { ...BASE_TOKENS };

module.exports = { BASE_TOKENS, TORAHTXT_TOKENS, SKYTUNED_TOKENS, SPOKESBOX_TOKENS, TODO_TOKENS };
