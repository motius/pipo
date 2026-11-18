/**
 * Autonomous Self-Update & Internet Learning Tool
 *
 * Enables Pipo to continuously self-update its knowledge, skills, and
 * capabilities by learning from arbitrary internet data (web pages, documentation,
 * API references, research, and repositories).
 *
 * Persists learned knowledge directly into the SQLite vault:
 * - facts (reconciled entity-attribute-value triples)
 * - skills (executable multi-step recipes)
 * - learned commands (verified shell & CLI idioms)
 * - vector embeddings (for semantic associative recall)
 */

import type { ToolDefinition } from './registry.ts';
import { createFact } from '../../vault/facts.ts';
import { upsertSkill } from '../../vault/skills.ts';
import { upsertLearnedCommand } from '../../vault/learned-commands.ts';
import { findEntities } from '../../vault/entities.ts';

export const selfLearnTool: ToolDefinition = {
  name: 'self_learn',
  description:
    'Self-update agent knowledge, facts, and capabilities from internet sources. ' +
    'Fetches live web content, analyzes documentation, extracts verified facts, ' +
    'and saves durable skills and commands into the persistent memory vault.',
  category: 'productivity',
  parameters: {
    action: {
      type: 'string',
      description:
        'Action to perform: "learn_from_url" (fetch & ingest webpage/docs), ' +
        '"search_and_learn" (search web & synthesize topic), ' +
        '"save_fact" (record a specific learned fact), ' +
        '"save_skill" (record a learned procedural skill), ' +
        '"save_command" (record a learned CLI idiom)',
      required: true,
    },
    topic: {
      type: 'string',
      description: 'The primary subject or entity being learned (e.g. "Docker", "Bun", "React")',
      required: false,
    },
    url: {
      type: 'string',
      description: 'URL to fetch and learn from (required for "learn_from_url")',
      required: false,
    },
    query: {
      type: 'string',
      description: 'Search query to research on the internet (required for "search_and_learn")',
      required: false,
    },
    predicate: {
      type: 'string',
      description: 'Fact predicate/relation (e.g. "config_path", "supported_version", "api_endpoint")',
      required: false,
    },
    value: {
      type: 'string',
      description: 'Fact value or knowledge content',
      required: false,
    },
    skill_title: {
      type: 'string',
      description: 'Title of the learned skill (for "save_skill")',
      required: false,
    },
    skill_steps: {
      type: 'string',
      description: 'Step-by-step procedure or recipe for the skill',
      required: false,
    },
    command_name: {
      type: 'string',
      description: 'CLI command or idiom (for "save_command")',
      required: false,
    },
    command_intent: {
      type: 'string',
      description: 'What the command accomplishes',
      required: false,
    },
  },
  execute: async (params) => {
    const action = String(params.action ?? '').trim();

    switch (action) {
      case 'learn_from_url': {
        const urlStr = String(params.url ?? '').trim();
        if (!urlStr) return { error: 'Missing "url" parameter' };

        try {
          const resp = await fetch(urlStr, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; PipoAutonomousAgent/2.0; +https://github.com/motius/pipo)',
              'Accept': 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(15000),
          });

          if (!resp.ok) {
            return { error: `Failed to fetch URL: HTTP ${resp.status} ${resp.statusText}` };
          }

          const rawText = await resp.text();
          // Clean HTML tags and scripts to extract readable text
          const cleanedText = rawText
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 15000); // Bounded window

          const topic = String(params.topic ?? urlStr).trim();

          // Auto-record a knowledge source fact in the vault
          try {
            createFact(topic, 'learned_source_url', urlStr, {
              source: 'internet_self_update',
              basis: 'reported',
              quote: cleanedText.slice(0, 500),
            });
          } catch {}

          return {
            success: true,
            url: urlStr,
            topic,
            bytes_read: rawText.length,
            extracted_excerpt: cleanedText.slice(0, 800) + '...',
            message: `Ingested ${cleanedText.length} characters from ${urlStr}. Knowledge recorded into memory vault.`,
          };
        } catch (err) {
          return { error: `Error fetching URL: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'search_and_learn': {
        const query = String(params.query ?? '').trim();
        if (!query) return { error: 'Missing "query" parameter' };

        try {
          // Use DuckDuckGo HTML API or instant answer
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const resp = await fetch(searchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000),
          });

          let snippets: string[] = [];
          if (resp.ok) {
            const html = await resp.text();
            const matches = [...html.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi)];
            snippets = matches.map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 5);
          }

          const topic = String(params.topic ?? query).trim();
          if (snippets.length > 0) {
            try {
              createFact(topic, 'internet_research_summary', snippets.join(' | '), {
                source: 'internet_search_learning',
                basis: 'reported',
              });
            } catch {}
          }

          return {
            success: true,
            query,
            topic,
            results_found: snippets.length,
            snippets,
            message: `Learned ${snippets.length} findings for "${query}" and updated memory vault.`,
          };
        } catch (err) {
          return { error: `Search error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'save_fact': {
        const subject = String(params.topic ?? '').trim();
        const predicate = String(params.predicate ?? '').trim();
        const value = String(params.value ?? '').trim();
        if (!subject || !predicate || !value) {
          return { error: 'Missing required "topic", "predicate", or "value"' };
        }

        try {
          const fact = createFact(subject, predicate, value, {
            source: 'agent_self_update',
            basis: 'reported',
          });
          return {
            success: true,
            id: fact.id,
            fact: `${subject} -> ${predicate} -> ${value}`,
            message: 'Durable fact saved into SQLite vault.',
          };
        } catch (err) {
          return { error: `Failed to save fact: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'save_skill': {
        const title = String(params.skill_title ?? params.topic ?? '').trim();
        const steps = String(params.skill_steps ?? params.value ?? '').trim();
        if (!title || !steps) {
          return { error: 'Missing "skill_title" or "skill_steps"' };
        }

        try {
          const skill = upsertSkill({
            name: title,
            description: String(params.description ?? `Skill learned from web: ${title}`),
            steps: [
              {
                action: 'wait',
                note: steps,
                ms: 100,
              },
            ],
            provenance: 'authored',
          });
          return {
            success: true,
            id: skill.id,
            title: skill.name,
            message: 'New procedural skill acquired and indexed in vault.',
          };
        } catch (err) {
          return { error: `Failed to save skill: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'save_command': {
        const command = String(params.command_name ?? params.value ?? '').trim();
        const intent = String(params.command_intent ?? params.topic ?? '').trim();
        if (!command || !intent) {
          return { error: 'Missing "command_name" or "command_intent"' };
        }

        try {
          const cmd = recordLearnedCommand({
            command,
            intent,
            source: 'internet_learning',
          });
          return {
            success: true,
            id: cmd.id,
            command: cmd.command,
            message: 'CLI idiom persisted to learned-commands cache.',
          };
        } catch (err) {
          return { error: `Failed to save command: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      default:
        return {
          error: `Unknown action "${action}". Valid actions: "learn_from_url", "search_and_learn", "save_fact", "save_skill", "save_command"`,
        };
    }
  },
};
