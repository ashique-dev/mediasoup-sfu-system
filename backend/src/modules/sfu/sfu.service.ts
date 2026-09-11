import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { Worker, Router, WebRtcTransport, Producer, Consumer } from 'mediasoup/node/lib/types';
import { mediasoupConfig } from '../../config/mediasoup.config';

@Injectable()
export class SfuService implements OnModuleInit, OnModuleDestroy {
  private workers: Worker[] = [];
  private nextWorkerIdx = 0;
  private routers = new Map<string, Router>();
  private transports = new Map<string, WebRtcTransport>();
  private producers = new Map<string, Producer>();
  private consumers = new Map<string, Consumer>();

  async onModuleInit() {
    await this.initWorkers();
  }

  async onModuleDestroy() {
    for (const worker of this.workers) {
      worker.close();
    }
  }

  private async initWorkers() {
    for (let i = 0; i < mediasoupConfig.numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker({
          logLevel: mediasoupConfig.worker.logLevel as any,
          logTags: mediasoupConfig.worker.logTags as any,
          rtcMinPort: mediasoupConfig.worker.rtcMinPort,
          rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
        });

        worker.on('died', () => {
          console.error(`mediasoup worker died, exiting 1... [pid:${worker.pid}]`);
          process.exit(1);
        });

        this.workers.push(worker);
      } catch (err) {
        console.error('Failed to create mediasoup worker:', err);
      }
    }
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  async getOrCreateRouter(roomId: string): Promise<Router> {
    if (!this.routers.has(roomId)) {
      const worker = this.getNextWorker();
      const router = await worker.createRouter({ mediaCodecs: mediasoupConfig.router.mediaCodecs });
      this.routers.set(roomId, router);
    }
    return this.routers.get(roomId)!;
  }

  async getRouterRtpCapabilities(roomId: string) {
    const router = await this.getOrCreateRouter(roomId);
    return router.rtpCapabilities;
  }

  async createWebRtcTransport(roomId: string) {
    const router = await this.getOrCreateRouter(roomId);
    const transport = await router.createWebRtcTransport({
      listenIps: mediasoupConfig.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
    });

    this.transports.set(transport.id, transport);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(transportId: string, dtlsParameters: any) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);
    await transport.connect({ dtlsParameters });
  }

  async produce(transportId: string, kind: 'audio' | 'video', rtpParameters: any, appData: any = {}) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({ kind, rtpParameters, appData });
    this.producers.set(producer.id, producer);
    return producer.id;
  }

  async consume(roomId: string, transportId: string, producerId: string, rtpCapabilities: any) {
    const router = await this.getOrCreateRouter(roomId);
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Client cannot consume producer with given RTP capabilities');
    }

    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    this.consumers.set(consumer.id, consumer);

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    };
  }

  async resumeConsumer(consumerId: string) {
    const consumer = this.consumers.get(consumerId);
    if (consumer) await consumer.resume();
  }
}
