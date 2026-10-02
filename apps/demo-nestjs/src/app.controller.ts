import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { NodeUIService } from '@singhak/nodeui-nestjs';

@Controller()
export class AppController {
  constructor(@Inject(NodeUIService) private readonly nodeui: NodeUIService) {}

  @Get('/hello')
  hello(): { message: string; via: string } {
    return { message: 'hello from nestjs demo', via: 'nodeui demo' };
  }

  @Get('/users/:id')
  user(@Param('id') id: string): { id: string; via: string } {
    return { id, via: 'nodeui demo' };
  }

  // Open it in Requests: headers and the (masked) response are captured; "Copy as curl" replays it.
  @Post('/orders')
  create(@Body() body: { customer?: string }): { id: number; customer?: string } {
    console.log('creating order for', body.customer ?? 'unknown');
    this.nodeui.recordQuery({
      system: 'demo-db',
      sql: 'INSERT INTO orders (customer, total) VALUES ($1, $2)',
      durationMs: 8,
      rowCount: 1,
    });
    return { id: 1001, customer: body.customer };
  }

  // Classic N+1, flagged in the Queries panel and shown in the request timeline.
  @Get('/orders')
  list(): { orders: number } {
    this.nodeui.recordQuery({ system: 'demo-db', sql: 'SELECT id FROM orders', durationMs: 3 });
    for (let id = 1; id <= 6; id++) {
      this.nodeui.recordQuery({
        system: 'demo-db',
        sql: `SELECT * FROM order_items WHERE order_id = ${id}`,
        durationMs: 1.5 + id / 4,
        rowCount: 3,
      });
    }
    return { orders: 6 };
  }

  // An exception filter-less throw: the Nest interceptor feeds it to the Errors panel.
  @Get('/crash/:id')
  crash(@Param('id') id: string): never {
    throw new TypeError(`cannot read plan of customer ${id}`);
  }
}
