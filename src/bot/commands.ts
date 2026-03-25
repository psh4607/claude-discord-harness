import { SlashCommandBuilder, type ChatInputCommandInteraction, type Guild } from 'discord.js';

import type { Config } from '../config/index.js';
import type { SessionPool } from '../session/pool.js';

const commands = [
  new SlashCommandBuilder().setName('stop').setDescription('현재 실행 중단'),
  new SlashCommandBuilder().setName('status').setDescription('세션 상태 확인'),
  new SlashCommandBuilder().setName('new').setDescription('세션 초기화 (새 세션)'),
  new SlashCommandBuilder().setName('compact').setDescription('세션 컨텍스트 압축'),
  new SlashCommandBuilder().setName('history').setDescription('최근 대화 로그 조회'),
  new SlashCommandBuilder()
    .setName('model')
    .setDescription('세션 모델 변경')
    .addStringOption(opt => opt.setName('name').setDescription('모델 이름').setRequired(true)),
  new SlashCommandBuilder()
    .setName('instructions')
    .setDescription('채널 CLAUDE.md 수정')
    .addStringOption(opt => opt.setName('text').setDescription('새 지시사항').setRequired(true)),
  new SlashCommandBuilder()
    .setName('superpowers')
    .setDescription('Superpowers 스킬')
    .addSubcommand(sub => sub.setName('brainstorming').setDescription('브레인스토밍으로 아이디어를 설계로 발전'))
    .addSubcommand(sub => sub.setName('writing-plans').setDescription('구현 계획 작성'))
    .addSubcommand(sub => sub.setName('test-driven-development').setDescription('TDD 기반 구현')),
  new SlashCommandBuilder()
    .setName('omc')
    .setDescription('Oh My Claude Code 스킬')
    .addSubcommand(sub => sub.setName('ralph').setDescription('자율 실행 루프'))
    .addSubcommand(sub => sub.setName('autopilot').setDescription('자율 구현'))
    .addSubcommand(sub => sub.setName('ultrawork').setDescription('병렬 실행 엔진')),
  new SlashCommandBuilder()
    .setName('skill')
    .setDescription('Claude Code 스킬 실행')
    .addStringOption(opt =>
      opt.setName('name').setDescription('스킬 이름').setRequired(true).setAutocomplete(true),
    ),
];

export async function registerCommands(guild: Guild): Promise<void> {
  await guild.commands.set(commands.map(c => c.toJSON()));
  console.log(`슬래시 커맨드 ${commands.length}개 등록 완료`);
}

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  pool: SessionPool,
  config: Config,
): Promise<void> {
  const bridge = pool.get(interaction.channelId);

  switch (interaction.commandName) {
    case 'stop':
      if (bridge) bridge.abort();
      await interaction.reply('실행을 중단했습니다.');
      break;

    case 'status':
      await interaction.reply(
        bridge
          ? `세션 ID: \`${bridge.currentSessionId || '(없음)'}\`\n모델: ${config.model}\n활성 세션: ${pool.activeCount}개`
          : '이 채널에 연결된 세션이 없습니다.',
      );
      break;

    case 'new':
      if (bridge) bridge.resetSession();
      await interaction.reply('세션을 초기화했습니다. 다음 메시지부터 새 세션이 시작됩니다.');
      break;

    case 'compact':
      if (bridge) {
        bridge.enqueue('/compact', 'system');
        await interaction.reply('컨텍스트 압축을 요청했습니다.');
      } else {
        await interaction.reply('연결된 세션이 없습니다.');
      }
      break;

    case 'model': {
      const modelName = interaction.options.getString('name', true);
      if (bridge) {
        bridge.setModel(modelName);
        await interaction.reply(`모델이 ${modelName}(으)로 변경되었습니다. 다음 메시지부터 적용됩니다.`);
      } else {
        await interaction.reply('연결된 세션이 없습니다.');
      }
      break;
    }

    case 'instructions': {
      const text = interaction.options.getString('text', true);
      if (bridge) {
        bridge.enqueue(`CLAUDE.md 파일의 내용을 다음으로 교체해줘:\n\n${text}`, 'system');
        await interaction.reply('지시사항 변경을 요청했습니다.');
      } else {
        await interaction.reply('연결된 세션이 없습니다.');
      }
      break;
    }

    case 'history':
      await interaction.reply(
        '대화 로그는 `.discord/chat-history/` 디렉토리에서 확인할 수 있습니다.',
      );
      break;

    case 'superpowers':
    case 'omc': {
      const sub = interaction.options.getSubcommand();
      const namespace = interaction.commandName === 'omc' ? 'oh-my-claudecode' : interaction.commandName;
      if (bridge) {
        bridge.enqueue(`/${namespace}:${sub}`, 'system');
        await interaction.reply(`\`/${namespace}:${sub}\` 스킬을 실행합니다.`);
      } else {
        await interaction.reply('연결된 세션이 없습니다.');
      }
      break;
    }

    case 'skill': {
      const name = interaction.options.getString('name', true);
      if (bridge) {
        bridge.enqueue(`/${name}`, 'system');
        await interaction.reply(`\`/${name}\` 스킬을 실행합니다.`);
      } else {
        await interaction.reply('연결된 세션이 없습니다.');
      }
      break;
    }

    default:
      await interaction.reply('알 수 없는 명령입니다.');
  }
}
