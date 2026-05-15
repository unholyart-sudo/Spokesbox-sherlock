'use strict';

/**
 * PROFILE_FIELDS: wizard questions removed from the main 5-step flow.
 * These are available via /profile for deeper personalization.
 * They are NOT wired into the wizard dispatcher.
 */
const PROFILE_FIELDS = [
  {
    key: 'setup_depth', section: 'setup',
    question: 'How much would you like to personalize today?',
    type: 'choice',
    options: [
      'Quick start — just the essentials (5 min)',
      'Full personalization — tell us everything (10 min)'
    ],
    sublabel: 'You can always fine-tune later'
  },
  {
    key: 'age_range', section: 'age',
    question: "What's your age range? (optional — helps us tailor content)",
    type: 'choice', optional: true,
    options: ['Under 18', '18–34', '35–54', '55–69', '70+', 'Prefer not to say']
  },
  {
    key: 'gender_identity', section: 'identity',
    question: "How do you identify? (optional — helps us personalize tone and content)",
    type: 'choice', optional: true,
    options: ['Man', 'Woman', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say']
  },
  {
    key: 'cultural_background', section: 'identity',
    question: "Any cultural backgrounds we should keep in mind? (optional)",
    type: 'text', optional: true,
    placeholder: 'e.g. Jewish, Latino, South Asian, LGBTQ+, Christian... anything that feels relevant'
  },
  {
    key: 'delivery_time', section: 'delivery',
    question: "What time would you like your newsletter delivered?",
    type: 'choice',
    options: ['6am', '7am', '8am', '9am', '10am', 'Noon']
  },
  {
    key: 'newsletter_length', section: 'length',
    question: "How long do you want your newsletter?",
    type: 'choice',
    options: ['Short (2 min read)', 'Medium (5 min)', 'Long (10 min)']
  },
  {
    key: 'tone', section: 'tone',
    question: "What's your tone preference?",
    type: 'choice',
    options: ['Warm & friendly', 'Informative & clean', 'Upbeat & fun']
  },
  {
    key: 'watchlist', section: 'follow',
    question: "Who should we watch for you?",
    sublabel: "Think journalists, founders, politicians, podcasters, athletes, companies — people and brands whose moves matter to you.\n\nEnter names or keywords, one per line or comma-separated. You can always update this later.",
    type: 'textarea', optional: true,
    placeholder: "e.g.\nElon Musk\nNBA, Warriors\nApple, NVIDIA\nPaul Graham"
  },
  {
    key: 'include_joke', section: 'extras',
    question: "Do you want a daily joke or fun fact included?",
    type: 'choice', optional: true,
    options: ['Yes, give me both!', 'Just the joke', 'Just the fun fact', 'No thanks']
  },
  {
    key: 'exclude', section: 'exclusions',
    question: "Any topics you absolutely don't want? (e.g. politics, sports)",
    type: 'text', optional: true,
    placeholder: "Type topics to exclude, or leave blank..."
  },
];

/**
 * BRANCH_FIELDS: contextual follow-up questions for topics selected in the wizard.
 * Available via /profile — no longer injected during wizard flow.
 */
const BRANCH_FIELDS = {
  sports_detail: {
    key: 'sports_detail', section: 'topic_details',
    question: "Which sports or teams? (e.g. NBA, Cowboys, F1)",
    type: 'text', optional: true,
    placeholder: 'e.g. NBA, Dallas Cowboys, F1, Golden State Warriors...'
  },
  college_sports: {
    key: 'college_sports', section: 'topic_details',
    question: "Which college do you follow? 🎓",
    sub: "We'll include scores, rankings, and recruiting news for your team.",
    type: 'text', optional: true,
    placeholder: 'e.g. Duke, Texas Longhorns, Michigan, Alabama...'
  },
  finance_detail: {
    key: 'finance_detail', section: 'topic_details',
    question: "Any specific stocks, crypto, or sectors?",
    type: 'text', optional: true,
    placeholder: 'e.g. NVDA, Bitcoin, healthcare, small-cap...'
  },
  book_genres: {
    key: 'book_genres', section: 'topic_details',
    question: "Any genres you love?",
    type: 'multi', optional: true,
    options: ['Fiction', 'Non-fiction', 'Mystery/Thriller', 'Sci-Fi', 'History', 'Business', 'Self-help', 'Whatever looks good']
  },
  tech_focus: {
    key: 'tech_focus', section: 'topic_details',
    question: "Any specific tech areas?",
    type: 'multi', optional: true,
    options: ['AI/ML', 'Startups', 'Consumer Tech', 'Cybersecurity', 'Space Tech']
  },
  health_focus: {
    key: 'health_focus', section: 'topic_details',
    question: "Any health focus?",
    type: 'multi', optional: true,
    options: ['Weight loss', 'Mental health', 'Nutrition', 'Strength training', 'Running', 'General wellness']
  },
  career_focus: {
    key: 'career_focus', section: 'topic_details',
    question: "What's your industry or role? 💼",
    sub: "We'll surface job opportunities, industry news, and trends relevant to your background.",
    type: 'text', optional: true,
    placeholder: 'e.g. software engineer, real estate, healthcare, finance, marketing...'
  },
  music_detail: {
    key: 'music_detail',
    section: 'music',
    question: 'What kinds of music do you love? 🎵',
    type: 'multi',
    options: ['Rock','Hip-Hop / R&B','Pop','Country','Jazz','Classical','Electronic','Folk / Indie','Latin','K-Pop'],
    sublabel: 'Pick all that apply'
  },
  movies_tv_detail: {
    key: 'movies_tv_detail',
    section: 'entertainment',
    question: 'What are your favorite genres? 🎬',
    type: 'multi',
    options: ['Drama','Comedy','Action / Thriller','Sci-Fi / Fantasy','Horror','Documentary','Reality TV','Animation','True Crime','Romance'],
    sublabel: 'Pick all that apply'
  },
  local_showtimes: {
    key: 'local_showtimes',
    section: 'topic_details',
    question: 'Want us to include local movie showtimes near you? 🎥',
    sub: "We'll find what's playing near your ZIP code each day.",
    type: 'choice',
    options: ['Yes, include showtimes!', 'No thanks']
  }
};

module.exports = { PROFILE_FIELDS, BRANCH_FIELDS };
