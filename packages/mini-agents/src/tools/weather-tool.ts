import { z } from 'zod';
import { tool } from './zod-tool';

// 简单工具（返回字符串）
export const getWeatherTool = tool({
  name: 'get_weather',
  description: 'Get the weather for a given city',
  parameters: z.object({ city: z.string() }),
  async execute({ city }) {
    return `The weather in ${city} is rain.`;
  },
});
