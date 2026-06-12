import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('services')
export class ServiceRegistration {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'jsonb' })
  capabilities: object; // array of { verb, target }

  @Column({ type: 'float', default: 80 })
  trustScore: number;

  @Column({ default: 'MEDIUM' })
  securityLevel: string;

  @Column({ nullable: true })
  endpoint: string;

  @Column({ name: 'last_heartbeat', type: 'timestamp', nullable: true })
  lastHeartbeat: Date;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}