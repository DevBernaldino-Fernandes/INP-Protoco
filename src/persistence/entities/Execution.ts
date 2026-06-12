import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('executions')
export class Execution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'intent_id' })
  intentId: string;

  @Column()
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  output: any;

  @Column({ type: 'text', nullable: true })
  error: string;

  @Column({ type: 'jsonb', nullable: true })
  steps: any; // array of step results

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @UpdateDateColumn({ name: 'completed_at', nullable: true })
  completedAt: Date;
}