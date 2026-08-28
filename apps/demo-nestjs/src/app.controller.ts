import { Controller, Get, Param } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('/hello')
  hello(): { message: string; via: string } {
    return { message: 'hello from nestjs demo', via: 'nodeui demo' };
  }

  @Get('/users/:id')
  user(@Param('id') id: string): { id: string; via: string } {
    return { id, via: 'nodeui demo' };
  }
}
