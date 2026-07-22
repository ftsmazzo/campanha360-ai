import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelAccountStatus } from '@prisma/client';
import {
  INBOX_INSTANCE_DISCONNECTED_MESSAGE,
  isEvolutionDisconnectErrorMessage,
  mapEvolutionConnectionStateToStatus,
} from './evolution-connection.util';

describe('evolution-connection.util', () => {
  it('mapeia estados Evolution para ChannelAccountStatus', () => {
    assert.equal(
      mapEvolutionConnectionStateToStatus('open'),
      ChannelAccountStatus.CONNECTED,
    );
    assert.equal(
      mapEvolutionConnectionStateToStatus('close'),
      ChannelAccountStatus.DISCONNECTED,
    );
    assert.equal(
      mapEvolutionConnectionStateToStatus('connecting'),
      ChannelAccountStatus.CONNECTING,
    );
    assert.equal(mapEvolutionConnectionStateToStatus('weird'), null);
  });

  it('detecta mensagens de desconexao sem expor destino', () => {
    assert.equal(
      isEvolutionDisconnectErrorMessage('Connection Closed'),
      true,
    );
    assert.equal(
      isEvolutionDisconnectErrorMessage('Provider rejeitou o conteudo'),
      false,
    );
    assert.match(INBOX_INSTANCE_DISCONNECTED_MESSAGE, /desconectada/i);
  });
});
