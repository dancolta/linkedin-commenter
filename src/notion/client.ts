import { Client } from '@notionhq/client';
import { NOTION_TOKEN } from '../config.js';

export const notion = new Client({ auth: NOTION_TOKEN });
